import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CastVoteDto } from './dto/cast-vote.dto';
// FIX: removed local JwtUser interface (had pid?: number — wrong; JWT stores pid
//      as a string via user.pid.toString() in auth.service.ts).
//      Import canonical JwtUser from the decorator instead.
import type { JwtUser } from '../common/decorators/current-user.decorator';
import type { Request } from 'express';

@Injectable()
export class VotingService {
  constructor(private prisma: PrismaService) {}

  async castVote(user: JwtUser, dto: CastVoteDto, req: Request) {
    // ── 1. Validate the identity being used to vote ──────────────────────
    // Ensures the session is permitted to act as member.orgid + member.uid.

    // ── 2. Load the event ────────────────────────────────────────────────
    const event = await this.prisma.events.findFirst({
      where: { event_id: dto.event_id, is_deleted: false },
    });
    if (!event) throw new NotFoundException('Event not found');
    // ── Resolve org member from JWT ─────────────────────────────
    if (!event.orgid) {
      throw new BadRequestException('Event is not linked to an organization');
    }
    let member;
    if (user.type === 'ORG') {
      member = await this.prisma.org_members.findFirst({
        where: {
          orgid: user.orgid,
          uid: user.uid,
          is_deleted: false,
        },
      });
    } else if (user.type === 'UNIFIED' && user.pid) {
      member = await this.prisma.org_members.findFirst({
        where: {
          orgid: event.orgid,
          pid: BigInt(user.pid),
          is_deleted: false,
        },
      });
    }

    if (!member) {
      throw new ForbiddenException('You are not a member of this organization');
    }
    if (member.orgid !== event.orgid) {
      throw new ForbiddenException(
        'You are not part of this event organization',
      );
    }
    // ── 3. Check event is currently open ────────────────────────────────
    const now = new Date();
    if (now < event.start_time) {
      throw new BadRequestException('Voting has not started yet');
    }
    if (now > event.end_time) {
      throw new BadRequestException('Voting period has ended');
    }
    if (event.status === 'CANCELLED') {
      throw new BadRequestException('Event has been cancelled');
    }

    // ── 4. Check caller is a registered participant ──────────────────────
    const participant = await this.prisma.event_participants.findFirst({
      where: { event_id: dto.event_id, orgid: member.orgid, uid: member.uid },
    });
    if (!participant) {
      throw new ForbiddenException('You are not a participant in this event');
    }

    // ── 5. Check not already voted ───────────────────────────────────────
    // Primary check via event_participants.has_voted (fast).
    if (participant.has_voted) {
      throw new ConflictException('You have already voted in this event');
    }

    // Secondary "already voted" check used to live here as a read against
    // the old `votes` table. votes no longer exists (finding #1 fix —
    // vote_ballots carries no identity to query by), so the race-condition
    // guard is now the atomic UPDATE ... WHERE has_voted = FALSE claim
    // inside cast_ballot() itself (step 10 below) — that claim IS the final
    // safety net now, in place of the old UNIQUE(event_id, orgid, uid).

    // ── 6. Validate candidate belongs to the event ───────────────────────
    const candidate = await this.prisma.candidates.findFirst({
      where: { candidate_id: dto.candidate_id, event_id: dto.event_id },
    });
    if (!candidate) {
      throw new BadRequestException('Candidate does not belong to this event');
    }

    // ── 7 & 8. Check voter role + scope eligibility ────────────────────────
    // Mirrors the DB trigger check_vote_validity exactly.
    //
    // FIX (multi-scope roles): member_roles PK is (orgid, uid, scope_id), so
    // a voter can hold several role rows across different scopes (e.g.
    // is_voter = false at one scope, is_voter = true at another). The old
    // code did member_roles.findFirst({ is_voter: true }) and evaluated
    // scope eligibility against that ONE arbitrary row — which could wrongly
    // deny a legitimate voter (if the non-matching row got picked) or, in
    // principle, evaluate eligibility under the wrong scope entirely. We now
    // fetch every is_voter = true role row for this member and accept the
    // vote if ANY of those rows clears scope eligibility for the event.
    //
    // Three eligibility cases based on event visibility flags:
    //   scope_only = TRUE  → a voter role's scope must exactly match event scope
    //   default (downward) → a voter role's scope must be a descendant of event scope
    //   visibility_upward  → additionally allow voter roles in ancestor scopes
    const voterRoles = await this.prisma.member_roles.findMany({
      where: { orgid: member.orgid, uid: member.uid, is_voter: true },
      select: { scope_id: true },
    });
    if (voterRoles.length === 0) {
      throw new ForbiddenException(
        'Your account does not have voter permissions',
      );
    }

    await this.assertScopeEligibilityForAny(
      event,
      voterRoles.map((r) => r.scope_id),
    );

    // ── 9. Extract IP ────────────────────────────────────────────────────
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      null;

    // ── 10. Cast the ballot ──────────────────────────────────────────────
    // FIX (finding #1 — vote anonymization split-table design): the old
    // `INSERT INTO votes (...)` wrote orgid/uid in cleartext into the same
    // row as voter_hash, which meant anyone with DB read access (or a
    // leaked backup, or the audit_votes snapshot) could see exactly who
    // voted for what. `votes` and its identity-keyed triggers are retired.
    //
    // cast_ballot() is now the only code path permitted to write a ballot.
    // In one transaction it: re-validates candidate/voter-role/scope
    // eligibility, atomically claims event_participants.has_voted (the sole
    // remaining identity <-> "has voted" intersection point, replacing the
    // old UNIQUE(event_id, orgid, uid) safety net), computes voter_hash from
    // (event_id, uid, salt), and inserts the anonymous row into
    // vote_ballots — which has no orgid/uid column at all. AFTER INSERT
    // triggers on vote_ballots then handle what's left:
    //   trg_vote_count       — increments vote_results
    //   audit_vote_ballots   — snapshots the row (safe: no identity in it)
    //
    // EDIT (Module B): the old trg_detect_vote_fraud (flat >4/>3
    // global-threshold trigger) has been dropped — it's being replaced by
    // Module C's self-baseline aggregation pipeline, not patched. Also as
    // of Module B, the IP passed in below is truncated to subnet
    // granularity inside cast_ballot() itself (truncate_ip_to_subnet())
    // before it's ever written to vote_ballots — this file still passes
    // the full-precision `ip` value in, but it never reaches disk at that
    // precision.
    //
    // The pre-flight checks above (steps 1-9) are unchanged and still what a
    // caller sees first — cast_ballot()'s own guards are the DB-level
    // last-resort, not the primary UX.
    const SALT = process.env.VOTER_HASH_SALT!;

    const vote = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
    SELECT set_config('app.voter_hash_salt', ${SALT}, true)
  `;
      const rows = await tx.$queryRaw<
        {
          vote_id: number;
          event_id: number;
          candidate_id: number;
          voted_at: Date;
          voter_hash: string;
        }[]
      >`
    SELECT * FROM cast_ballot(
      ${member.orgid}, ${member.uid}, ${dto.event_id}, ${dto.candidate_id},
      ${ip}::inet, ${dto.device_fingerprint ?? null}
    )
  `;
      return rows[0];
    });

    // ── 11. Optionally return live results ───────────────────────────────
    let live_results: any[] | null = null;
    if (event.show_live_results) {
      live_results = await this.prisma.vote_results.findMany({
        where: { event_id: dto.event_id },
        include: {
          candidates: { select: { candidate_name: true } },
        },
        orderBy: { vote_count: 'desc' },
      });
    }

    return {
      message: 'Vote cast successfully',
      vote,
      ...(live_results && { live_results }),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Checks the voter's scope against the event's visibility configuration.
   *
   * Mirrors the DB trigger check_vote_validity (Full_Postgres_Schema.txt) so
   * that the application returns a readable 403 rather than a raw Postgres
   * exception when scope eligibility fails.
   *
   * Three cases (mutually exclusive by DB constraint):
   *
   *   scope_only = TRUE
   *     → voter scope must exactly equal event scope_id.
   *       No descendants, no ancestors.
   *
   *   default (scope_only = FALSE, visibility_upward = FALSE)
   *     → voter scope must be a descendant of (or equal to) event scope_id.
   *       This is the standard downward-visibility case.
   *
   *   visibility_upward = TRUE (scope_only implicitly FALSE per DB constraint)
   *     → voter scope may be a descendant OR an ancestor of event scope_id.
   *
   * FIX: the previous implementation only called get_scope_descendants(),
   *      which modelled only the default downward case and got the other two
   *      wrong — silently allowing ineligible descendants under scope_only,
   *      and silently rejecting eligible ancestors under visibility_upward.
   */
  /**
   * FIX (multi-scope roles): accepts ALL of the voter's is_voter = true
   * scope_ids and succeeds if ANY one of them clears eligibility — instead
   * of the old single-scope-id version, which only ever saw one arbitrarily
   * chosen role row.
   */
  private async assertScopeEligibilityForAny(
    event: {
      scope_id: number | null;
      scope_only: boolean | null;
      visibility_upward: boolean | null;
    },
    voterScopeIds: number[],
  ) {
    const eventScopeId = event.scope_id;
    if (eventScopeId === null) return; // org-wide event — always eligible

    // ── Case 1: scope_only ───────────────────────────────────────────────
    if (event.scope_only) {
      if (voterScopeIds.includes(eventScopeId)) return;
      throw new ForbiddenException(
        'This event is restricted to a specific scope. Your scope is not eligible.',
      );
    }

    // ── Case 2 & 3: downward (always) + upward (optional) ───────────────
    const descendantRows = await this.prisma.$queryRaw<{ scope_id: number }[]>`
      SELECT scope_id FROM get_scope_descendants(${eventScopeId}::int)
    `;
    const descendants = descendantRows.map((r) => Number(r.scope_id));

    if (voterScopeIds.some((id) => descendants.includes(id))) return; // eligible via downward

    // ── Case 3: check ancestors if visibility_upward is set ─────────────
    if (event.visibility_upward) {
      const ancestorRows = await this.prisma.$queryRaw<{ scope_id: number }[]>`
        SELECT scope_id FROM get_scope_ancestors(${eventScopeId}::int)
      `;
      const ancestors = ancestorRows.map((r) => Number(r.scope_id));

      if (voterScopeIds.some((id) => ancestors.includes(id))) return; // eligible via upward
    }

    throw new ForbiddenException(
      'Your scope is not eligible to vote in this event',
    );
  }
}
