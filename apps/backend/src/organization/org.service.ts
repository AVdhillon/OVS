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

// ─── CSV Parser ───────────────────────────────────────────────────────────────
// Parses: uid,mobile,email,role  (header row required)
export function parseCsvParticipants(csv: string): ParticipantRowDto[] {
  const lines = csv
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const uidIdx = header.indexOf('uid');
  const mobileIdx = header.indexOf('mobile');
  const emailIdx = header.indexOf('email');
  const roleIdx = header.indexOf('role');

  if (uidIdx === -1) {
    throw new BadRequestException('CSV must have a "uid" column');
  }

  return lines.slice(1).map((line, i) => {
    const cols = line.split(',').map((c) => c.trim());
    const uid = cols[uidIdx];
    if (!uid) throw new BadRequestException(`Row ${i + 2}: uid is required`);

    const row: ParticipantRowDto = { uid: uid.toUpperCase() };
    if (mobileIdx !== -1 && cols[mobileIdx]) row.mobile = cols[mobileIdx];
    if (emailIdx !== -1 && cols[emailIdx]) row.email = cols[emailIdx];

    const role = roleIdx !== -1 ? cols[roleIdx] : 'v';
    row.role = role === 'vo' ? 'vo' : 'v';

    return row;
  });
}

// ─── Org ID Generator ─────────────────────────────────────────────────────────
function generateOrgId(
  orgName: string,
  prefix?: string,
  suffix?: string,
): string {
  const p = prefix ?? orgName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  const s = suffix ?? String(Math.floor(1000 + Math.random() * 9000));
  return `${p}${s}`;
}

@Injectable()
export class OrgService {
  constructor(private prisma: PrismaService) { }

  // ─── Register Organization ──────────────────────────────────────────────────
  async registerOrg(
    pid: bigint,
    callerUid: string | undefined,
    dto: RegisterOrgDto,
  ) {
    // Merge participants from table input and CSV
    let participants: ParticipantRowDto[] = dto.participants ?? [];
    if (dto.participants_csv) {
      participants = [...participants, ...parseCsvParticipants(dto.participants_csv)];
    }

    // Deduplicate by uid
    const seen = new Map<string, ParticipantRowDto>();
    for (const p of participants) {
      seen.set(p.uid.toUpperCase(), p);
    }
    const deduped = Array.from(seen.values());

    // Generate org ID
    let orgid = generateOrgId(dto.org_name, dto.org_prefix, dto.org_suffix);

    // Collision check — retry up to 5 times
    for (let i = 0; i < 5; i++) {
      const exists = await this.prisma.organization.findUnique({ where: { orgid } });
      if (!exists) break;
      orgid = generateOrgId(dto.org_name, dto.org_prefix);
      if (i === 4) throw new ConflictException('Could not generate unique org ID. Try a different prefix.');
    }

    // The caller must supply their own uid for this org.
    // We use callerUid if provided (ORG login context) or derive one from pid.
    // For a fresh org registration from a UNIFIED account, the caller provides their desired uid.
    if (!callerUid) {
      throw new BadRequestException(
        'You must supply your uid for the new organization via the request body (caller_uid)',
      );
    }

    const callerUidNorm = callerUid.trim().toUpperCase();

    if (!/^[A-Z0-9]{4,20}$/.test(callerUidNorm)) {
      throw new BadRequestException(
        'Invalid Organizer Uid format. Must be 4–20 uppercase alphanumeric characters.'
      );
    }
    // Run everything in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
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

      // 3. Insert caller as member with vo role
      await tx.org_members.create({
        data: {
          orgid,
          uid: callerUidNorm,
          pid,
          is_deleted: false,
        },
      });

      // 4. Assign caller role: voter + organizer at ROOT scope
      await tx.member_roles.create({
        data: {
          orgid,
          uid: callerUidNorm,
          is_voter: true,
          is_organizer: true,
          scope_id: rootScope.scope_id,
        },
      });

      // 5. Bind orgid to caller's account via user_org
      await tx.user_org.create({
        data: { pid, orgid, uid: callerUidNorm },
      });

      // 6. Insert participants (skip if uid === caller)
      for (const p of deduped) {
        if (p.uid === callerUidNorm) continue; // already added

        await tx.org_members.create({
          data: {
            orgid,
            uid: p.uid,
            mobile: p.mobile ?? null,
            email: p.email ?? null,
            is_deleted: false,
          },
        });

        await tx.member_roles.create({
          data: {
            orgid,
            uid: p.uid,
            is_voter: true,
            is_organizer: p.role === 'vo',
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
    const links = await this.prisma.user_org.findMany({
      where: { pid },
      select: { orgid: true, uid: true },
    });
    if (links.length === 0) return [];

    const organizerLinks = await Promise.all(
      links.map(async (l) => {
        const role = await this.prisma.member_roles.findUnique({
          where: { orgid_uid: { orgid: l.orgid, uid: l.uid } },
        });
        return role?.is_organizer ? l : null;
      }),
    );

    const validLinks = organizerLinks.filter(Boolean) as { orgid: string; uid: string }[];
    const orgIdToUid = Object.fromEntries(validLinks.map((l) => [l.orgid, l.uid]));

    const orgs = await this.prisma.organization.findMany({
      where: { orgid: { in: validLinks.map((l) => l.orgid) }, is_deleted: false },
      select: {
        orgid: true,
        org_name: true,
        org_email: true,
        is_active: true,
        created_at: true,
      },
    });

    // ✅ attach uid so frontend can pass it back as org context
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

    const callerScope = await this.getCallerScope(orgid, callerUid);
    const visibleScopes = await this.getDescendantScopeIds(callerScope);

    const members = await this.prisma.org_members.findMany({
      where: {
        orgid,
        is_deleted: false,
        member_roles: {
          scope_id: { in: visibleScopes },
          ...(filters?.role === 'organizer' ? { is_organizer: true } : {}),
          ...(filters?.role === 'voter' ? { is_voter: true } : {}),
          ...(filters?.scope_id ? { scope_id: filters.scope_id } : {}),
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
      is_voter: m.member_roles?.is_voter ?? false,
      is_organizer: m.member_roles?.is_organizer ?? false,
      scope_id: m.member_roles?.scope_id ?? null,
    }));
  }

  // ─── Add members ────────────────────────────────────────────────────────────
  async addMembers(pid: bigint, orgid: string, callerUid: string, dto: AddMembersDto) {
    await this.assertOrganizerAccess(orgid, callerUid);

    const callerScope = await this.getCallerScope(orgid, callerUid);
    const visibleScopes = await this.getDescendantScopeIds(callerScope);

    // Determine target scope
    let targetScopeId = dto.scope_id ?? callerScope;
    if (!visibleScopes.includes(targetScopeId)) {
      throw new ForbiddenException('Cannot assign members to a scope outside your jurisdiction');
    }

    let participants: ParticipantRowDto[] = dto.participants ?? [];
    if (dto.participants_csv) {
      participants = [...participants, ...parseCsvParticipants(dto.participants_csv)];
    }
    if (participants.length === 0) {
      throw new BadRequestException('No participants provided');
    }

    const results: { uid: string; status: string; error?: string }[] = [];

    for (const p of participants) {
      try {
        const existing = await this.prisma.org_members.findUnique({
          where: { orgid_uid: { orgid, uid: p.uid } },
        });

        if (existing) {
          if (existing.is_deleted) {
            // Reactivate
            await this.prisma.org_members.update({
              where: { orgid_uid: { orgid, uid: p.uid } },
              data: {
                is_deleted: false,
                mobile: p.mobile ?? existing.mobile,
                email: p.email ?? existing.email,
              },
            });
            await this.prisma.member_roles.update({
              where: { orgid_uid: { orgid, uid: p.uid } },
              data: {
                is_voter: true,
                is_organizer: p.role === 'vo',
                scope_id: targetScopeId,
              },
            });
            results.push({ uid: p.uid, status: 'reactivated' });
          } else {
            results.push({ uid: p.uid, status: 'skipped', error: 'Already exists' });
          }
          continue;
        }

        await this.prisma.org_members.create({
          data: { orgid, uid: p.uid, mobile: p.mobile ?? null, email: p.email ?? null },
        });
        await this.prisma.member_roles.create({
          data: {
            orgid,
            uid: p.uid,
            is_voter: true,
            is_organizer: p.role === 'vo',
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

  // ─── Update member role / scope ─────────────────────────────────────────────
  async updateMember(
    pid: bigint,
    orgid: string,
    callerUid: string,
    targetUid: string,
    dto: UpdateMemberDto,
  ) {
    await this.assertOrganizerAccess(orgid, callerUid);

    const callerScope = await this.getCallerScope(orgid, callerUid);
    const visibleScopes = await this.getDescendantScopeIds(callerScope);

    // Get target's current scope
    const targetRole = await this.prisma.member_roles.findUnique({
      where: { orgid_uid: { orgid, uid: targetUid } },
    });
    if (!targetRole) throw new NotFoundException('Member not found');

    // Caller can only edit members within their scope
    if (!visibleScopes.includes(targetRole.scope_id)) {
      throw new ForbiddenException('Cannot edit member outside your scope');
    }

    // If moving scope, check new scope is within caller's tree
    if (dto.scope_id !== undefined && !visibleScopes.includes(dto.scope_id)) {
      throw new ForbiddenException('Cannot move member to a scope outside your jurisdiction');
    }

    const updated = await this.prisma.member_roles.update({
      where: { orgid_uid: { orgid, uid: targetUid } },
      data: {
        ...(dto.is_voter !== undefined && { is_voter: dto.is_voter }),
        ...(dto.is_organizer !== undefined && { is_organizer: dto.is_organizer }),
        ...(dto.scope_id !== undefined && { scope_id: dto.scope_id }),
      },
    });

    return updated;
  }

  // ─── Soft-delete member ─────────────────────────────────────────────────────
  async removeMember(pid: bigint, orgid: string, callerUid: string, targetUid: string) {
    await this.assertOrganizerAccess(orgid, callerUid);

    const callerScope = await this.getCallerScope(orgid, callerUid);
    const visibleScopes = await this.getDescendantScopeIds(callerScope);

    const targetRole = await this.prisma.member_roles.findUnique({
      where: { orgid_uid: { orgid, uid: targetUid } },
    });
    if (!targetRole) throw new NotFoundException('Member not found');

    if (!visibleScopes.includes(targetRole.scope_id)) {
      throw new ForbiddenException('Cannot remove member outside your scope');
    }

    await this.prisma.org_members.update({
      where: { orgid_uid: { orgid, uid: targetUid } },
      data: { is_deleted: true },
    });

    return { message: `Member ${targetUid} removed from ${orgid}` };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  async assertOrganizerAccess(orgid: string, callerUid: string) {
    const role = await this.prisma.member_roles.findUnique({
      where: { orgid_uid: { orgid, uid: callerUid } },
    });
    if (!role?.is_organizer) {
      throw new ForbiddenException('Organizer access required');
    }
  }

  async getCallerScope(orgid: string, uid: string): Promise<number> {
    const role = await this.prisma.member_roles.findUnique({
      where: { orgid_uid: { orgid, uid } },
    });
    if (!role) throw new NotFoundException('Member role not found');
    return role.scope_id;
  }

  async getDescendantScopeIds(scopeId: number): Promise<number[]> {
    // Use the DB function get_scope_descendants via raw query
    const rows = await this.prisma.$queryRaw<{ scope_id: number }[]>`
      SELECT scope_id FROM get_scope_descendants(${scopeId})
    `;
    return rows.map((r) => Number(r.scope_id));
  }
}
