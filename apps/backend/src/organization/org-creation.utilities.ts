import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { splitIdentifier } from '../common/utils/check.utilities';
import type { ParticipantRowDto } from './dto/register-org.dto';

// ─── Organization creation core ───────────────────────────────────────────────
// EDIT (Phase 2 — org request staging, subphase 2.4): extracted out of
// org.service.ts's registerOrg(), which was steps 1–6 of its transaction
// body (create org -> fetch ROOT scope -> insert first member -> assign
// roles -> add wallet identity -> insert any extra participants).
//
// Why now, and not in 2.2: 2.2 only extracted the orgid *allocation* (the
// pre-check + collision retry) because that was all registerOrg() needed a
// second caller for at the time. This subphase's approve() needs the
// org-creation steps themselves — the actual INSERTs — which is a different
// piece of the same method. Splitting it out here rather than having
// OrgRequestsService import OrgService (or vice versa) keeps both services
// depending on a leaf module instead of on each other.
//
// Behaviour for registerOrg()'s existing call sites is unchanged: this is
// the same six steps, same order, same error conditions, just addressed by
// one caller-supplied "owner" instead of always being the DTO's
// caller_uid/caller_identifier/pid. The one thing this function does NOT
// do, on purpose, is choose the orgid or run inside a retry loop — that's
// still runWithUniqueOrgId() (orgid.utilities.ts) calling this, not this
// calling that.

/**
 * The account being bound as this organization's first member + organizer
 * at ROOT scope. For registerOrg() this is the caller (their own choice of
 * uid, or the uid carried on an ORG session's JWT). For approve() this is
 * the request's original submitter — see generateInitialOwnerUid() in
 * org-requests.service.ts for why *that* caller has no uid of their own to
 * supply.
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
  /** Additional members to seed alongside the owner. Empty for approve() — see 2.3's note that roster import is post-approval setup. */
  participants?: ParticipantRowDto[];
}

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
  const { owner, orgEmail = null, participants = [] } = params;

  await tx.$executeRaw`
    SELECT set_config('app.current_uid', ${owner.uid}, true)
  `;

  // 1. Create org (trigger auto-creates ROOT scope)
  //
  // EDIT (Phase 2 — subphase 2.1): was `is_active: true`.
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
