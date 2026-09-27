import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
// EDIT (Phase 2 — subphase 2.2): orgid generation, the pre-check, and the
// collision-retry loop now live in one shared helper so 2.4's
// OrgRequestsService.approve() can create organizations the same way.
// The `Prisma` namespace import that used to sit here went with them —
// isOrgIdUniqueConflict() was its only consumer in this file.
import { runWithUniqueOrgId, ORG_ID_FORMAT, isOrgIdAvailable } from './orgid.utilities';
// EDIT (Phase 2 — subphase 2.4): the six-step org-creation transaction body
// itself now lives in org-creation.utilities.ts too, alongside orgid
// allocation, so OrgRequestsService.approve() can run the same steps for a
// different "owner" (the request's original submitter, not the caller).
import { createOrganizationCore } from './org-creation.utilities';
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

    // EDIT (Phase 2 — subphase 2.2): the orgid pre-check and the
    // TOCTOU retry loop that used to be written out here (and again around
    // the transaction below) are now runWithUniqueOrgId() in
    // ./orgid.utilities. Behaviour is identical; the difference is that
    // 2.4's approve() can call the same thing instead of reimplementing a
    // race-condition fix.
    const { orgid, result } = await runWithUniqueOrgId(
      this.prisma,
      {
        orgName: dto.org_name,
        preferredOrgId: dto.preferred_orgid,
        prefix: dto.org_prefix,
        suffix: dto.org_suffix,
      },
      // EDIT (Phase 2 — subphase 2.4): the six INSERT steps that used to be
      // written out inline here now live in createOrganizationCore()
      // (org-creation.utilities.ts) — the same steps, same order, addressed
      // by an "owner" (pid/uid/identifier) instead of always being this
      // method's own caller. registerOrg()'s owner is the caller themself;
      // approve()'s is the request's original submitter (see
      // generateInitialOwnerUid() there for why that owner has no uid of
      // their own to supply). set_config('app.current_uid', …) moved inside
      // the shared function too — it was always keyed on the first
      // member's uid being created, not specifically "the caller", so
      // nothing about its meaning changes.
      (tx, orgid) =>
        createOrganizationCore(tx, orgid, dto.org_name, {
          orgEmail: dto.org_email,
          owner: { pid, uid: callerUidNorm, identifier: callerIdentifier },
          participants: deduped,
        }),
    );

    return {
      orgid,
      org_name: result.org.org_name,
      root_scope_id: result.rootScope.scope_id,
      message: `Organization "${result.org.org_name}" created with ID ${orgid}`,
    };
  }

  // ─── Org ID availability ────────────────────────────────────────────────────
  // EDIT (Phase 6 — post-approval org finalization, subphase 6.5): backs
  // GET /org/orgid-available (org.controller.ts) — the finalize-setup
  // wizard's live-typing check (6.3's finalizeSetup() still does the real,
  // race-safe allocation via runWithUniqueOrgId at actual submission time;
  // this is only ever the cheap, non-reserving pre-check for UI feedback).
  async checkOrgIdAvailable(rawOrgid: string) {
    const orgid = (rawOrgid ?? '').trim().toUpperCase();
    if (!ORG_ID_FORMAT.test(orgid)) {
      throw new BadRequestException(
        'orgid must be in format ABC1234 (3 letters, 4 digits)',
      );
    }
    const available = await isOrgIdAvailable(this.prisma, orgid);
    return { orgid, available };
  }

  // ─── Get orgs where user is organizer ──────────────────────────────────────
  async getMyOrgs(pid: bigint) {    const links = await this.prisma.org_members.findMany({
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
        // EDIT (Phase 7 — Member Limit Increase Requests, subphase 7.4):
        // added so the organizer's own dashboard can show "current limit +
        // usage" (post-approval-org-setup-plan.md, 7.4) without a second
        // round trip. No app-facing endpoint exposed member_limit before
        // this — org-directory.service.ts's equivalent (member_count too)
        // is the *site admin*'s org-detail view, a separate controller this
        // app has no access to.
        member_limit: true,
      },
    });

    // Active member_count per org, same `is_deleted = FALSE` definition
    // org-directory.service.ts's getCounts() already uses for the site-admin
    // org-detail view — kept consistent rather than inventing a second
    // definition of "how many members does this org have" for the same
    // underlying column.
    const memberCounts = await this.prisma.org_members.groupBy({
      by: ['orgid'],
      where: { orgid: { in: orgs.map((o) => o.orgid) }, is_deleted: false },
      _count: { _all: true },
    });
    const memberCountByOrgid = Object.fromEntries(
      memberCounts.map((c) => [c.orgid, c._count._all]),
    );

    return orgs.map((o) => ({
      ...o,
      uid: orgIdToUid[o.orgid],
      member_count: memberCountByOrgid[o.orgid] ?? 0,
    }));
  }

  // ─── Get org for an ORG-session caller ───────────────────────────────────────
  // BUGFIX: GET /org/mine (org.controller.ts::getMyOrgs) was calling
  // getMyOrgs() above unconditionally, including for ORG sessions — passing
  // BigInt(user.pid!). getMyOrgs()'s pid-based lookup exists for UNIFIED
  // sessions, where a single unified account can be linked (via
  // identity_wallet) to organizer roles across several different orgs. An
  // ORG session doesn't need that: it already knows exactly which
  // org_members row it is from its own JWT (orgid + uid), and
  // org_members.pid is legitimately NULL for a member who was never linked
  // to a unified account (chk_member_identity only requires pid OR mobile
  // OR email) — which is exactly the case that made `BigInt(user.pid!)`
  // throw "Cannot convert null to a BigInt" for that member.
  //
  // This mirrors getMyOrgs()'s return shape (including member_count) so the
  // controller can hand back the same OrgSummary[] shape for either session
  // type — the frontend (manage-organizations-view.tsx::fetchOrgs) already
  // filters an ORG session's result down to session.orgid regardless, this
  // just returns that one org (or []) directly instead of crashing before
  // it gets the chance to filter.
  async getMyOrgForOrgSession(orgid: string, uid: string) {
    const role = await this.prisma.member_roles.findFirst({
      where: { orgid, uid, is_organizer: true },
    });
    if (!role) return [];

    const org = await this.prisma.organization.findFirst({
      where: { orgid, is_deleted: false },
      select: {
        orgid: true,
        org_name: true,
        org_email: true,
        is_active: true,
        created_at: true,
        member_limit: true,
      },
    });
    if (!org) return [];

    const member_count = await this.prisma.org_members.count({
      where: { orgid, is_deleted: false },
    });

    return [{ ...org, uid, member_count }];
  }

  // ─── Get self info for an ORG-session caller (Account tab) ──────────────────
  // EDIT (Account tab, ORG sessions): getMyOrgForOrgSession() above is
  // organizer-gated (it exists to drive the "manage this org" surfaces),
  // which leaves a *plain* ORG member — no organizer role anywhere — with
  // no way to see even their own org's name/contact. manage-account-view.tsx
  // used to render nothing at all for an ORG session because of this (the
  // page was built entirely around the UNIFIED `user` object). This is the
  // deliberately organizer-free counterpart: any active member of the org
  // may read their own uid + their org's name/contact, nothing more.
  async getOrgSelfInfo(orgid: string, uid: string) {
    const member = await this.prisma.org_members.findFirst({
      where: { orgid, uid, is_deleted: false },
      select: { uid: true },
    });
    if (!member) {
      throw new NotFoundException('Membership not found');
    }

    const org = await this.prisma.organization.findFirst({
      where: { orgid, is_deleted: false },
      select: { orgid: true, org_name: true, org_email: true },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return {
      orgid: org.orgid,
      org_name: org.org_name,
      org_email: org.org_email,
      uid: member.uid,
    };
  }

  // ─── Get members (scope-filtered for organizer) ─────────────────────────────
  // BUGFIX: dropped the unused `pid: bigint` param — see org.controller.ts's
  // getMembers() comment. It was never referenced in this method body (all
  // scoping here runs off callerUid), so it was dead weight that just forced
  // the controller to crash-cast a legitimately-nullable ORG-session pid.
  async getMembers(
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
  // BUGFIX: dropped the unused `pid: bigint` param — see org.controller.ts's
  // addMembers() comment.
  async addMembers(
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

    // EDIT (Phase 6 — subphase 6.4): friendly guard in front of the DB-level
    // backstop (trg_check_member_limit, dbschema.sql). Without this, a
    // roster import that runs past the cap partway through would surface the
    // trigger's raw Postgres exception text as this row's `error` field
    // instead of a clean message — same "friendly guard in front of a
    // DB-level backstop" shape the plan asks for, tracked here as a running
    // in-memory counter rather than a fresh COUNT(*) query per row. This is
    // deliberately advisory, not authoritative: it's read outside any
    // transaction, so a concurrent request against the same org can still
    // race past it — the trigger is what actually holds the line.
    const org = await this.prisma.organization.findUnique({
      where: { orgid },
      select: { member_limit: true },
    });
    if (!org) {
      throw new NotFoundException(`Organization ${orgid} not found`);
    }
    let activeMemberCount = await this.prisma.org_members.count({
      where: { orgid, is_deleted: false },
    });

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
            // Reactivating counts as growing the org the same as a brand new
            // member would (see trg_check_member_limit's own comment on why
            // it treats UPDATE-to-active the same as INSERT).
            if (activeMemberCount + 1 > org.member_limit) {
              results.push({
                uid: p.uid,
                status: 'error',
                error: `Organization has reached its member limit of ${org.member_limit}`,
              });
              continue;
            }

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

            activeMemberCount++;
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
        if (activeMemberCount + 1 > org.member_limit) {
          results.push({
            uid: p.uid,
            status: 'error',
            error: `Organization has reached its member limit of ${org.member_limit}`,
          });
          continue;
        }

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

        activeMemberCount++;
        results.push({ uid: p.uid, status: 'added' });
      } catch (err: any) {
        results.push({ uid: p.uid, status: 'error', error: err.message });
      }
    }

    return { results };
  }

  // ─── Update member role at a specific scope ──────────────────────────────────
  // scope_id in the DTO identifies which member_roles row to update.
  // BUGFIX: dropped the unused `pid: bigint` param — see org.controller.ts's
  // updateMember() comment.
  async updateMember(
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
  // BUGFIX: dropped the unused `pid: bigint` param — see org.controller.ts's
  // removeMember() comment.
  async removeMember(
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
  // BUGFIX: dropped the unused `pid: bigint` param — see org.controller.ts's
  // addMemberRole() comment.
  async addMemberRole(
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
  // BUGFIX: dropped the unused `pid: bigint` param — see org.controller.ts's
  // removeMemberRole() comment.
  async removeMemberRole(
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
  // BUGFIX: dropped the unused `pid: bigint` param — see org.controller.ts's
  // moveMemberRole() comment.
  async moveMemberRole(
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
   * - SITEADMIN session: never has an org identity.
   *
   * EDIT (Phase 1 — auth model consolidation, subphase 1.4): GOV retired
   * (subphase 1.2 narrowed JwtUser.type to 'UNIFIED' | 'ORG' | 'SITEADMIN')
   * — only the fallback throw below and this comment changed; the
   * ORG/UNIFIED branches themselves are untouched.
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

    throw new ForbiddenException('SITEADMIN sessions have no org identity');
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
