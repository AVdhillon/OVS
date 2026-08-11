import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterOrgDto, ParticipantRowDto } from './dto/register-org.dto';
import { AddMembersDto } from './dto/add-members.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { splitIdentifier } from '../common/utils/check.utilities';
import type { JwtUser } from '../common/decorators/current-user.decorator';

// ─── CSV Parser ───────────────────────────────────────────────────────────────
// Parses: uid,contact,role  (header row required)
export function parseCsvParticipants(csv: string): ParticipantRowDto[] {
  const lines = csv
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const uidIdx = header.indexOf('uid');
  const contactIdx = header.indexOf('contact');
  const roleIdx = header.indexOf('role');

  if (uidIdx === -1) {
    throw new BadRequestException('CSV must have a "uid" column');
  }

  return lines.slice(1).map((line, i) => {
    const cols = line.split(',').map((c) => c.trim());
    const uid = cols[uidIdx];
    if (!uid) throw new BadRequestException(`Row ${i + 2}: uid is required`);

    const row: ParticipantRowDto = { uid: uid.toUpperCase() };
    if (!cols[contactIdx])
      throw new BadRequestException(`Row ${i + 2}: contact is required`);
    row.participant_identifier = cols[contactIdx];
    const role = roleIdx !== -1 ? cols[roleIdx] : 'v';
    row.role = (['v', 'vo', 'o', 'none'] as const).includes(role as any)
      ? (role as 'v' | 'vo' | 'o' | 'none')
      : 'v';
    return row;
  });
}

// ─── Org ID Generator ─────────────────────────────────────────────────────────
function generateOrgId(
  orgName: string,
  prefix?: string,
  suffix?: string,
): string {
  const p =
    prefix ??
    orgName
      .replace(/[^A-Za-z]/g, '')
      .slice(0, 3)
      .toUpperCase();
  const s = suffix ?? String(Math.floor(1000 + Math.random() * 9000));
  return `${p}${s}`;
}

@Injectable()
export class OrgService {
  constructor(private prisma: PrismaService) {}

  // ─── Register Organization ──────────────────────────────────────────────────
  async registerOrg(
    pid: bigint,
    callerUid: string | undefined,
    callerIdentifier: string | undefined,
    dto: RegisterOrgDto,
  ) {
    if (!callerUid) {
      throw new BadRequestException(
        'caller_uid is required. Supply it in the request body (UNIFIED session) ' +
          'or log in with an ORG session.',
      );
    }
    const callerUidNorm = callerUid.trim().toUpperCase();

    if (!/^[A-Z0-9]{4,20}$/.test(callerUidNorm)) {
      throw new BadRequestException(
        'Invalid caller_uid format. Must be 4–20 uppercase alphanumeric characters.',
      );
    }

    if (!callerIdentifier) {
      throw new BadRequestException(
        'caller_identifier (mobile or email) is required to register an organization.',
      );
    }

    // Merge participants from table input and CSV
    let participants: ParticipantRowDto[] = dto.participants ?? [];
    if (dto.participants_csv) {
      participants = [
        ...participants,
        ...parseCsvParticipants(dto.participants_csv),
      ];
    }

    // Deduplicate by uid
    const seen = new Map<string, ParticipantRowDto>();
    for (const p of participants) {
      seen.set(p.uid.toUpperCase(), p);
    }
    const deduped = Array.from(seen.values());

    // Generate org ID
    const preferredOrgId = dto.preferred_orgid?.trim().toUpperCase();
    let orgid: string;

    if (preferredOrgId) {
      const exists = await this.prisma.organization.findUnique({
        where: { orgid: preferredOrgId },
      });
      if (exists) {
        throw new ConflictException(
          `Organization ID "${preferredOrgId}" is already taken.`,
        );
      }
      orgid = preferredOrgId;
    } else {
      orgid = generateOrgId(dto.org_name, dto.org_prefix, dto.org_suffix);

      for (let i = 0; i < 5; i++) {
        const exists = await this.prisma.organization.findUnique({
          where: { orgid },
        });
        if (!exists) break;
        orgid = generateOrgId(dto.org_name, dto.org_prefix);
        if (i === 4) {
          throw new ConflictException(
            'Could not generate unique org ID. Try again.',
          );
        }
      }
    }

    // Run everything in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT set_config('app.current_uid', ${callerUidNorm}, true)
      `;

      // 1. Create org (trigger auto-creates ROOT scope)
      const org = await tx.organization.create({
        data: {
          orgid,
          org_name: dto.org_name,
          org_email: dto.org_email ?? null,
          is_active: true,
        },
      });

      // 2. Fetch the auto-created ROOT scope
      const rootScope = await tx.org_scope.findFirst({
        where: { orgid, parent_scope_id: null },
      });
      if (!rootScope) throw new Error('ROOT scope not created');

      // 3. Insert caller as member
      const { email, mobile } = splitIdentifier(callerIdentifier);

      await tx.org_members.create({
        data: {
          orgid,
          uid: callerUidNorm,
          pid,
          email,
          mobile,
          is_deleted: false,
        },
      });

      // 4. Assign caller a single role row: voter + organizer at ROOT scope
      await tx.member_roles.create({
        data: {
          orgid,
          uid: callerUidNorm,
          is_voter: true,
          is_organizer: true,
          scope_id: rootScope.scope_id,
        },
      });

      // 5. Add organizer identity to wallet
      await tx.identity_wallet.create({
        data: {
          pid,
          identity_type: 'ORG',
          identity_id: orgid,
          uid: callerUidNorm,
        },
      });

      // 6. Insert participants (skip if uid === caller)
      for (const p of deduped) {
        if (p.uid === callerUidNorm) continue;
        if (!p.participant_identifier)
          throw new BadRequestException(
            `Participant ${p.uid}: contact is required`,
          );

        const { email, mobile } = splitIdentifier(p.participant_identifier);

        await tx.org_members.create({
          data: {
            orgid,
            uid: p.uid,
            mobile,
            email,
            is_deleted: false,
          },
        });

        // One role row per participant at ROOT scope
        await tx.member_roles.create({
          data: {
            orgid,
            uid: p.uid,
            is_voter: p.role === 'v' || p.role === 'vo',
            is_organizer: p.role === 'o' || p.role === 'vo',
            scope_id: rootScope.scope_id,
          },
        });
      }

      return { org, rootScope };
    });

    return {
      orgid,
      org_name: result.org.org_name,
      root_scope_id: result.rootScope.scope_id,
      message: `Organization "${result.org.org_name}" created with ID ${orgid}`,
    };
  }

  // ─── Get orgs where user is organizer ──────────────────────────────────────
  async getMyOrgs(pid: bigint) {
    const links = await this.prisma.org_members.findMany({
      where: { pid },
      select: { orgid: true, uid: true },
    });
    if (links.length === 0) return [];

    // A member is an organizer if they have at least one role row with is_organizer = true
    const organizerLinks = await Promise.all(
      links.map(async (l) => {
        const role = await this.prisma.member_roles.findFirst({
          where: { orgid: l.orgid, uid: l.uid, is_organizer: true },
        });
        return role ? l : null;
      }),
    );

    const validLinks = organizerLinks.filter(Boolean) as {
      orgid: string;
      uid: string;
    }[];
    const orgIdToUid = Object.fromEntries(
      validLinks.map((l) => [l.orgid, l.uid]),
    );

    const orgs = await this.prisma.organization.findMany({
      where: {
        orgid: { in: validLinks.map((l) => l.orgid) },
        is_deleted: false,
      },
      select: {
        orgid: true,
        org_name: true,
        org_email: true,
        is_active: true,
        created_at: true,
      },
    });

    return orgs.map((o) => ({ ...o, uid: orgIdToUid[o.orgid] }));
  }

  // ─── Get members (scope-filtered for organizer) ─────────────────────────────
  async getMembers(
    pid: bigint,
    orgid: string,
    callerUid: string,
    filters?: { role?: string; scope_id?: number; search?: string },
  ) {
    await this.assertOrganizerAccess(orgid, callerUid);

    const callerOrganizerScopes = await this.getCallerOrganizerScopes(
      orgid,
      callerUid,
    );
    const visibleScopes = await this.getDescendantScopeIds(
      callerOrganizerScopes,
    );

    // Build the scope filter for the member_roles relation
    const roleFilter: Record<string, any> = {
      scope_id: { in: visibleScopes },
    };
    if (filters?.role === 'organizer') roleFilter.is_organizer = true;
    if (filters?.role === 'voter') roleFilter.is_voter = true;
    if (filters?.scope_id) roleFilter.scope_id = filters.scope_id;

    const members = await this.prisma.org_members.findMany({
      where: {
        orgid,
        is_deleted: false,
        // Member must have at least one qualifying role row
        member_roles: {
          some: roleFilter,
        },
        ...(filters?.search
          ? {
              OR: [
                { uid: { contains: filters.search, mode: 'insensitive' } },
                { email: { contains: filters.search, mode: 'insensitive' } },
                { mobile: { contains: filters.search } },
              ],
            }
          : {}),
      },
      select: {
        uid: true,
        mobile: true,
        email: true,
        pid: true,
        member_roles: {
          where: { scope_id: { in: visibleScopes } },
          select: {
            is_voter: true,
            is_organizer: true,
            scope_id: true,
          },
        },
      },
    });

    return members.map((m) => ({
      uid: m.uid,
      mobile: m.mobile,
      email: m.email,
      pid: m.pid?.toString() ?? null,
      // Each entry represents an independent scope assignment
      roles: m.member_roles.map((r) => ({
        scope_id: r.scope_id,
        is_voter: r.is_voter,
        is_organizer: r.is_organizer,
      })),
    }));
  }

  // ─── Add members ────────────────────────────────────────────────────────────
  async addMembers(
    pid: bigint,
    orgid: string,
    callerUid: string,
    dto: AddMembersDto,
  ) {
    await this.assertOrganizerAccess(orgid, callerUid);

    const callerOrganizerScopes = await this.getCallerOrganizerScopes(
      orgid,
      callerUid,
    );
    const visibleScopes = await this.getDescendantScopeIds(
      callerOrganizerScopes,
    );

    // Default target scope: caller's first organizer scope
    const targetScopeId = dto.scope_id ?? callerOrganizerScopes[0];
    if (!visibleScopes.includes(targetScopeId)) {
      throw new ForbiddenException(
        'Cannot assign members to a scope outside your jurisdiction',
      );
    }

    let participants: ParticipantRowDto[] = dto.participants ?? [];
    if (dto.participants_csv) {
      participants = [
        ...participants,
        ...parseCsvParticipants(dto.participants_csv),
      ];
    }
    if (participants.length === 0) {
      throw new BadRequestException('No participants provided');
    }

    const results: { uid: string; status: string; error?: string }[] = [];

    for (const p of participants) {
      try {
        if (!p.participant_identifier) {
          results.push({
            uid: p.uid,
            status: 'error',
            error: 'contact is required',
          });
          continue;
        }
        const { email, mobile } = splitIdentifier(p.participant_identifier);

        const existing = await this.prisma.org_members.findUnique({
          where: { orgid_uid: { orgid, uid: p.uid } },
        });

        const isVoter = p.role === 'v' || p.role === 'vo';
        const isOrganizer = p.role === 'o' || p.role === 'vo';

        if (existing) {
          if (existing.is_deleted) {
            // Reactivate: restore org_members and upsert a role at the target scope
            await this.prisma.org_members.update({
              where: { orgid_uid: { orgid, uid: p.uid } },
              data: {
                is_deleted: false,
                mobile: mobile ?? existing.mobile,
                email: email ?? existing.email,
              },
            });

            // Upsert role at target scope — member may have pre-existing rows
            await this.prisma.member_roles.upsert({
              where: {
                orgid_uid_scope_id: {
                  orgid,
                  uid: p.uid,
                  scope_id: targetScopeId,
                },
              },
              create: {
                orgid,
                uid: p.uid,
                is_voter: isVoter,
                is_organizer: isOrganizer,
                scope_id: targetScopeId,
              },
              update: { is_voter: isVoter, is_organizer: isOrganizer },
            });

            results.push({ uid: p.uid, status: 'reactivated' });
          } else {
            // Member already active — upsert the role at the target scope
            await this.prisma.member_roles.upsert({
              where: {
                orgid_uid_scope_id: {
                  orgid,
                  uid: p.uid,
                  scope_id: targetScopeId,
                },
              },
              create: {
                orgid,
                uid: p.uid,
                is_voter: isVoter,
                is_organizer: isOrganizer,
                scope_id: targetScopeId,
              },
              update: { is_voter: isVoter, is_organizer: isOrganizer },
            });
            results.push({ uid: p.uid, status: 'role_assigned' });
          }
          continue;
        }

        // New member — create org_members + a role row at target scope
        await this.prisma.org_members.create({
          data: { orgid, uid: p.uid, mobile, email },
        });
        await this.prisma.member_roles.create({
          data: {
            orgid,
            uid: p.uid,
            is_voter: isVoter,
            is_organizer: isOrganizer,
            scope_id: targetScopeId,
          },
        });

        results.push({ uid: p.uid, status: 'added' });
      } catch (err: any) {
        results.push({ uid: p.uid, status: 'error', error: err.message });
      }
    }

    return { results };
  }

  // ─── Update member role at a specific scope ──────────────────────────────────
  // scope_id in the DTO identifies which member_roles row to update.
  async updateMember(
    pid: bigint,
    orgid: string,
    callerUid: string,
    targetUid: string,
    dto: UpdateMemberDto,
  ) {
    await this.assertOrganizerAccess(orgid, callerUid);

    const callerOrganizerScopes = await this.getCallerOrganizerScopes(
      orgid,
      callerUid,
    );
    const visibleScopes = await this.getDescendantScopeIds(
      callerOrganizerScopes,
    );

    // Jurisdiction check FIRST — must not leak whether a role exists at a
    // scope outside the caller's visibility.
    if (!visibleScopes.includes(dto.scope_id)) {
      throw new ForbiddenException('Cannot edit member outside your scope');
    }

    // Locate the specific role row being updated
    const targetRole = await this.prisma.member_roles.findUnique({
      where: {
        orgid_uid_scope_id: { orgid, uid: targetUid, scope_id: dto.scope_id },
      },
    });
    if (!targetRole) {
      throw new NotFoundException(
        `No role found for member ${targetUid} at scope ${dto.scope_id}`,
      );
    }

    if (dto.is_organizer === false && targetRole.is_organizer === true) {
      await this.assertNotLastOrganizer(orgid, targetUid, dto.scope_id);
    }

    const updated = await this.prisma.member_roles.update({
      where: {
        orgid_uid_scope_id: { orgid, uid: targetUid, scope_id: dto.scope_id },
      },
      data: {
        ...(dto.is_voter !== undefined && { is_voter: dto.is_voter }),
        ...(dto.is_organizer !== undefined && {
          is_organizer: dto.is_organizer,
        }),
      },
    });

    return updated;
  }

  // ─── Soft-delete member ─────────────────────────────────────────────────────
  async removeMember(
    pid: bigint,
    orgid: string,
    callerUid: string,
    targetUid: string,
  ) {
    await this.assertOrganizerAccess(orgid, callerUid);

    const callerOrganizerScopes = await this.getCallerOrganizerScopes(
      orgid,
      callerUid,
    );
    const visibleScopes = await this.getDescendantScopeIds(
      callerOrganizerScopes,
    );

    const memberRoles = await this.prisma.member_roles.findMany({
      where: { orgid, uid: targetUid },
    });
    if (memberRoles.length === 0) {
      throw new NotFoundException('Member not found');
    }

    // Every one of the target's role rows must be inside the caller's
    // jurisdiction — not just one of them. If the target holds roles outside
    // the caller's visible scopes, the caller cannot fully remove them.
    const outOfJurisdiction = memberRoles.filter(
      (r) => !visibleScopes.includes(r.scope_id),
    );
    if (outOfJurisdiction.length > 0) {
      throw new ForbiddenException(
        'Member holds roles outside your scope; remove those role assignments ' +
          '(via a higher-scoped organizer) before this member can be fully removed.',
      );
    }

    for (const role of memberRoles) {
      if (role.is_organizer === true) {
        await this.assertNotLastOrganizer(orgid, targetUid, role.scope_id);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.member_roles.deleteMany({ where: { orgid, uid: targetUid } });
      await tx.org_members.update({
        where: { orgid_uid: { orgid, uid: targetUid } },
        data: { is_deleted: true },
      });
    });

    return { message: `Member ${targetUid} removed from ${orgid}` };
  }
  async addMemberRole(
    pid: bigint,
    orgid: string,
    callerUid: string,
    targetUid: string,
    dto: { scope_id: number; is_voter: boolean; is_organizer: boolean },
  ) {
    await this.assertOrganizerAccess(orgid, callerUid);

    const callerOrganizerScopes = await this.getCallerOrganizerScopes(
      orgid,
      callerUid,
    );
    const visibleScopes = await this.getDescendantScopeIds(
      callerOrganizerScopes,
    );

    if (!visibleScopes.includes(dto.scope_id)) {
      throw new ForbiddenException(
        'Cannot assign member to a scope outside your jurisdiction',
      );
    }

    const member = await this.prisma.org_members.findUnique({
      where: { orgid_uid: { orgid, uid: targetUid } },
    });
    if (!member || member.is_deleted) {
      throw new NotFoundException(`Member ${targetUid} not found`);
    }

    // Upsert: if an assignment already exists at this scope, update it.
    const role = await this.prisma.member_roles.upsert({
      where: {
        orgid_uid_scope_id: { orgid, uid: targetUid, scope_id: dto.scope_id },
      },
      create: {
        orgid,
        uid: targetUid,
        scope_id: dto.scope_id,
        is_voter: dto.is_voter,
        is_organizer: dto.is_organizer,
      },
      update: { is_voter: dto.is_voter, is_organizer: dto.is_organizer },
    });

    return {
      scope_id: role.scope_id,
      is_voter: role.is_voter,
      is_organizer: role.is_organizer,
    };
  }

  // ─── Remove one scope assignment from a member ───────────────────────────────
  // If this is the member's last assignment, soft-deletes org_members too.
  async removeMemberRole(
    pid: bigint,
    orgid: string,
    callerUid: string,
    targetUid: string,
    scopeId: number,
  ) {
    await this.assertOrganizerAccess(orgid, callerUid);

    const callerOrganizerScopes = await this.getCallerOrganizerScopes(
      orgid,
      callerUid,
    );
    const visibleScopes = await this.getDescendantScopeIds(
      callerOrganizerScopes,
    );

    if (!visibleScopes.includes(scopeId)) {
      throw new ForbiddenException('Cannot remove a role outside your scope');
    }

    const targetRole = await this.prisma.member_roles.findUnique({
      where: {
        orgid_uid_scope_id: { orgid, uid: targetUid, scope_id: scopeId },
      },
    });
    if (!targetRole) {
      throw new NotFoundException(
        `No role found for member ${targetUid} at scope ${scopeId}`,
      );
    }

    if (targetRole.is_organizer === true) {
      await this.assertNotLastOrganizer(orgid, targetUid, scopeId);
    }

    await this.prisma.member_roles.delete({
      where: {
        orgid_uid_scope_id: { orgid, uid: targetUid, scope_id: scopeId },
      },
    });

    // If this was the member's last role row, deactivate the org_members record.
    const remaining = await this.prisma.member_roles.count({
      where: { orgid, uid: targetUid },
    });
    if (remaining === 0) {
      await this.prisma.org_members.update({
        where: { orgid_uid: { orgid, uid: targetUid } },
        data: { is_deleted: true },
      });
    }

    return { message: `Role at scope ${scopeId} removed from ${targetUid}` };
  }

  // ─── Atomically move one scope assignment to a different scope ───────────────
  async moveMemberRole(
    pid: bigint,
    orgid: string,
    callerUid: string,
    targetUid: string,
    dto: {
      from_scope_id: number;
      to_scope_id: number;
      is_voter?: boolean;
      is_organizer?: boolean;
    },
  ) {
    await this.assertOrganizerAccess(orgid, callerUid);

    const callerOrganizerScopes = await this.getCallerOrganizerScopes(
      orgid,
      callerUid,
    );
    const visibleScopes = await this.getDescendantScopeIds(
      callerOrganizerScopes,
    );

    if (!visibleScopes.includes(dto.from_scope_id)) {
      throw new ForbiddenException(
        'Cannot move a role from a scope outside your jurisdiction',
      );
    }
    if (!visibleScopes.includes(dto.to_scope_id)) {
      throw new ForbiddenException(
        'Cannot move a role to a scope outside your jurisdiction',
      );
    }

    const fromRole = await this.prisma.member_roles.findUnique({
      where: {
        orgid_uid_scope_id: {
          orgid,
          uid: targetUid,
          scope_id: dto.from_scope_id,
        },
      },
    });
    if (!fromRole) {
      throw new NotFoundException(
        `No role found for ${targetUid} at scope ${dto.from_scope_id}`,
      );
    }

    const existing = await this.prisma.member_roles.findUnique({
      where: {
        orgid_uid_scope_id: {
          orgid,
          uid: targetUid,
          scope_id: dto.to_scope_id,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `${targetUid} already has an assignment at scope ${dto.to_scope_id}. ` +
          `Remove it first or use updateMember to edit it.`,
      );
    }

    // Carry over roles from the source row unless the caller overrides them.
    const is_voter = dto.is_voter ?? fromRole.is_voter;
    const is_organizer = dto.is_organizer ?? fromRole.is_organizer;

    const [, newRole] = await this.prisma.$transaction([
      this.prisma.member_roles.delete({
        where: {
          orgid_uid_scope_id: {
            orgid,
            uid: targetUid,
            scope_id: dto.from_scope_id,
          },
        },
      }),
      this.prisma.member_roles.create({
        data: {
          orgid,
          uid: targetUid,
          scope_id: dto.to_scope_id,
          is_voter,
          is_organizer,
        },
      }),
    ]);

    return {
      scope_id: newRole.scope_id,
      is_voter: newRole.is_voter,
      is_organizer: newRole.is_organizer,
    };
  }
  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Resolves the uid the caller is allowed to act as within `orgid`.
   * - ORG session: uid is baked into the JWT — trust it as-is.
   * - UNIFIED session: uid must come from org_members.pid = user.pid.
   *   An optional client-supplied `requestedUid` is only honored if it
   *   matches a row actually owned by this pid — otherwise 403.
   * - GOV session: never has an org identity.
   */
  async resolveCallerUid(
    user: JwtUser,
    orgid: string,
    requestedUid?: string,
  ): Promise<string> {
    if (user.type === 'ORG') {
      if (!user.uid) throw new ForbiddenException('Invalid ORG session');
      return user.uid;
    }

    if (user.type === 'UNIFIED') {
      if (!user.pid) throw new ForbiddenException('Invalid session');

      const links = await this.prisma.org_members.findMany({
        where: { orgid, pid: BigInt(user.pid), is_deleted: false },
        select: { uid: true },
      });

      if (links.length === 0) {
        throw new ForbiddenException(
          'You are not a member of this organization',
        );
      }

      if (requestedUid) {
        const requestedNorm = requestedUid.trim().toUpperCase();
        const match = links.find((l) => l.uid === requestedNorm);
        if (!match) {
          throw new ForbiddenException(
            'requested uid does not belong to your account',
          );
        }
        return match.uid;
      }

      if (links.length > 1) {
        // Same pid holds multiple uids in this org — caller must disambiguate.
        throw new BadRequestException(
          'Multiple identities found in this org; specify uid explicitly',
        );
      }

      return links[0].uid;
    }

    throw new ForbiddenException('GOV sessions have no org identity');
  }

  /**
   * Throws ForbiddenException unless the caller has at least one
   * is_organizer = true role row in the given org.
   */
  async assertOrganizerAccess(orgid: string, callerUid: string) {
    const role = await this.prisma.member_roles.findFirst({
      where: { orgid, uid: callerUid, is_organizer: true },
    });
    if (!role) {
      throw new ForbiddenException('Organizer access required');
    }
  }

  /**
   * Throws if removing/downgrading `targetUid`'s organizer row at `scopeId`
   * would leave the org with zero organizers. Intentionally a simple
   * org-wide organizer count rather than a precise subtree-coverage check —
   * precise per-scope coverage checking is more correct but meaningfully
   * more complex; start simple and tighten later if actually needed.
   */
  async assertNotLastOrganizer(
    orgid: string,
    targetUid: string,
    scopeId: number,
  ) {
    const otherOrganizerCount = await this.prisma.member_roles.count({
      where: {
        orgid,
        is_organizer: true,
        NOT: { AND: [{ uid: targetUid }, { scope_id: scopeId }] },
      },
    });
    if (otherOrganizerCount === 0) {
      throw new ConflictException(
        'Cannot remove the last organizer of this organization',
      );
    }
  }

  /**
   * Returns all scope_ids where the caller holds is_organizer = true.
   * These are the roots of the caller's jurisdiction.
   */
  async getCallerOrganizerScopes(
    orgid: string,
    uid: string,
  ): Promise<number[]> {
    const roles = await this.prisma.member_roles.findMany({
      where: { orgid, uid, is_organizer: true },
      select: { scope_id: true },
    });
    if (roles.length === 0) {
      throw new NotFoundException('No organizer roles found for this member');
    }
    return roles.map((r) => r.scope_id);
  }

  /**
   * Returns the union of all descendants (including self) for the given
   * list of scope root IDs — i.e. the full jurisdiction of the caller.
   */
  async getDescendantScopeIds(scopeIds: number[]): Promise<number[]> {
    const allIds = new Set<number>();
    for (const scopeId of scopeIds) {
      if (!Number.isInteger(scopeId)) {
        throw new BadRequestException(
          `Invalid scope_id "${scopeId}": expected an integer`,
        );
      }
      const rows = await this.prisma.$queryRaw<{ scope_id: number }[]>`
        SELECT scope_id FROM get_scope_descendants(${scopeId}::int)
      `;
      rows.forEach((r) => allIds.add(Number(r.scope_id)));
    }
    return Array.from(allIds);
  }
}
