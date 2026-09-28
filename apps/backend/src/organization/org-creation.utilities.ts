import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { splitIdentifier } from '../common/utils/check.utilities';
import type { ParticipantRowDto } from './dto/register-org.dto';

// ─── Organization creation core ───────────────────────────────────────────────
// The shared INSERT sequence for creating an organization: create org ->
// fetch ROOT scope -> insert first member -> assign roles -> add wallet
// identity -> insert any extra participants.
//
// Lives in its own leaf module rather than inside OrgService so that both
// registerOrg() and OrgRequestsService.finalizeSetup() can call it without
// OrgRequestsService importing OrgService (or vice versa) — both services
// depend on this leaf instead of on each other.
//
// The first member + organizer is passed in as a caller-supplied "owner"
// rather than always being derived from the DTO. What this function does
// NOT do, on purpose, is choose the orgid or run inside a retry loop —
// that's runWithUniqueOrgId() (orgid.utilities.ts) calling this, not this
// calling that.

/**
 * The account being bound as this organization's first member + organizer
 * at ROOT scope. For registerOrg() this is the caller (their own choice of
 * uid, or the uid carried on an ORG session's JWT). For finalizeSetup()
 * (org-requests.service.ts) this is the request's
 * original submitter, supplying their own chosen uid at finalization time
 * (FinalizeOrgRequestDto.owner_uid) — see that DTO field's own comment.
 */
export interface OrgOwner {
  pid: bigint;
  uid: string;
  /** Mobile or email — split via splitIdentifier() into org_members' columns. */
  identifier: string;
}

export interface OrgCreationParams {
  orgEmail?: string | null;
  owner: OrgOwner;
  /** Additional members to seed alongside the owner. Empty for approve() — see the note that roster import is post-approval setup. */
  participants?: ParticipantRowDto[];
  /**
   * 
   * organization.member_limit is NOT NULL with no DEFAULT, so every
   * org creation must supply one. finalizeSetup()
   * (org-requests.service.ts) always passes the locked request's
   * `admin_set_member_limit` here — non-null by the time a request reaches
   * APPROVED_PENDING_SETUP (chk_org_request_review_consistency enforces
   * that at the DB level), so that call site never relies on the default
   * below.
   *
   * Left optional here, rather than required, only because registerOrg()'s
   * self-serve path (org.service.ts) has no admin-set cap to carry over —
   * see SELF_SERVE_DEFAULT_MEMBER_LIMIT's own comment for why that's a
   * flagged placeholder, not a resolved product decision.
   */
  memberLimit?: number;
}

/**
 * FLAGGED DECISION — open product question. For request-created orgs the
 * cap comes from org_requests.admin_set_member_limit, but
 * organization.member_limit is NOT NULL with no DEFAULT, so registerOrg()'s
 * self-serve creation path — which has no admin to set a cap — needs *some* value or
 * every self-serve registration starts failing the column's NOT NULL
 * constraint. A generous, arbitrary platform default is used here so
 * self-serve registration keeps working; product should confirm whether
 * self-serve orgs should be capped at all, and if so at what number
 * (possibly requester-chosen, mirroring expected_member_count on the
 * request path).
 */
export const SELF_SERVE_DEFAULT_MEMBER_LIMIT = 500;

export interface OrgCreationResult {
  org: { org_name: string };
  rootScope: { scope_id: number };
}

/**
 * Creates the organization row and its first member/organizer, plus any
 * additional participants, inside an already-open transaction. Must be
 * called with the orgid already decided — this function does not allocate
 * one (see runWithUniqueOrgId in orgid.utilities.ts, which is what should
 * be calling this).
 */
export async function createOrganizationCore(
  tx: Prisma.TransactionClient,
  orgid: string,
  orgName: string,
  params: OrgCreationParams,
): Promise<OrgCreationResult> {
  const {
    owner,
    orgEmail = null,
    participants = [],
    // See OrgCreationParams.memberLimit's own
    // comment and SELF_SERVE_DEFAULT_MEMBER_LIMIT's for why a default is
    // needed at all.
    memberLimit = SELF_SERVE_DEFAULT_MEMBER_LIMIT,
  } = params;

  await tx.$executeRaw`
    SELECT set_config('app.current_uid', ${owner.uid}, true)
  `;

  // 1. Create org (trigger auto-creates ROOT scope)
  //
  // Was `is_active: true`.
  // `organization.is_active` is now a GENERATED column derived from the new
  // `organization.status` (see the master schema SQL), and Postgres rejects
  // any write to it outright:
  //   ERROR: cannot insert a non-DEFAULT value into column "is_active"
  // Prisma introspects a generated column as an ordinary field, so the old
  // line still type-checked — it would only have failed at runtime, on
  // every single registration. Setting `status` instead produces exactly
  // the same `is_active = true` result.
  const org = await tx.organization.create({
    data: {
      orgid,
      org_name: orgName,
      org_email: orgEmail,
      status: 'ACTIVE',
      // member_limit is NOT NULL — set here, at INSERT time, rather than
      // as a follow-up UPDATE in finalizeSetup(), which is cleaner and
      // avoids a window where the row exists without a cap.
      member_limit: memberLimit,
    },
  });

  // 2. Fetch the auto-created ROOT scope
  const rootScope = await tx.org_scope.findFirst({
    where: { orgid, parent_scope_id: null },
  });
  if (!rootScope) throw new Error('ROOT scope not created');

  // 3. Insert owner as member
  const { email, mobile } = splitIdentifier(owner.identifier);

  await tx.org_members.create({
    data: {
      orgid,
      uid: owner.uid,
      pid: owner.pid,
      email,
      mobile,
      is_deleted: false,
    },
  });

  // 4. Assign owner a single role row: voter + organizer at ROOT scope
  await tx.member_roles.create({
    data: {
      orgid,
      uid: owner.uid,
      is_voter: true,
      is_organizer: true,
      scope_id: rootScope.scope_id,
    },
  });

  // 5. Add organizer identity to wallet
  await tx.identity_wallet.create({
    data: {
      pid: owner.pid,
      identity_type: 'ORG',
      identity_id: orgid,
      uid: owner.uid,
    },
  });

  // 6. Insert participants (skip if uid === owner)
  for (const p of participants) {
    if (p.uid === owner.uid) continue;
    if (!p.participant_identifier)
      throw new BadRequestException(
        `Participant ${p.uid}: contact is required`,
      );

    const { email: pEmail, mobile: pMobile } = splitIdentifier(
      p.participant_identifier,
    );

    await tx.org_members.create({
      data: {
        orgid,
        uid: p.uid,
        mobile: pMobile,
        email: pEmail,
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
}
