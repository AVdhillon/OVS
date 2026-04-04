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
    if (user.type === 'GOV') {
      throw new ForbiddenException('Government identity cannot vote');
    }
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

    // Secondary check via votes table as a race-condition guard.
    // The UNIQUE(event_id, orgid, uid) DB constraint is the final safety net.
    const existingVote = await this.prisma.votes.findFirst({
      where: { event_id: dto.event_id, orgid: member.orgid, uid: member.uid },
    });
    if (existingVote) {
      throw new ConflictException('You have already voted in this event');
    }

    // ── 6. Validate candidate belongs to the event ───────────────────────
    const candidate = await this.prisma.candidates.findFirst({
      where: { candidate_id: dto.candidate_id, event_id: dto.event_id },
    });
    if (!candidate) {
      throw new BadRequestException('Candidate does not belong to this event');
    }

    // ── 7. Check voter role ──────────────────────────────────────────────
    const role = await this.prisma.member_roles.findFirst({
      where: { orgid: member.orgid, uid: member.uid, is_voter: true },
    });
    if (!role) {
      throw new ForbiddenException(
        'Your account does not have voter permissions',
      );
    }

    // ── 8. Check scope eligibility ───────────────────────────────────────
    // Mirrors the DB trigger check_vote_validity exactly.
    // Three cases based on event visibility flags:
    //
    //   scope_only = TRUE  → voter's scope must exactly match event scope
    //   default (downward) → voter's scope must be a descendant of event scope
    //   visibility_upward  → additionally allow voters in ancestor scopes
    //
    // FIX: the previous code only checked get_scope_descendants(), which:
    //   • incorrectly allowed ALL descendants when scope_only = TRUE
    //     (only the exact scope should be eligible)
    //   • incorrectly rejected ancestor scopes when visibility_upward = TRUE
    await this.assertScopeEligibility(event, role.scope_id);

    // ── 9. Extract IP ────────────────────────────────────────────────────
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      null;

    // ── 10. Insert vote ──────────────────────────────────────────────────
    // DB triggers fire after insert:
    //   trg_anonymize_vote          — sets voter_hash from uid + salt
    //   trg_validate_vote_candidate — confirms candidate belongs to event
    //   trg_check_voter_role        — confirms is_voter = true
    //   trg_vote_validity           — final scope eligibility check
    //   trg_vote_count              — increments vote_results
    //   trg_mark_participant_voted  — flips event_participants.has_voted
    //   trg_detect_vote_fraud       — logs suspicious IP/device patterns
    const vote = await this.prisma.votes.create({
      data: {
        event_id: dto.event_id,
        orgid: member.orgid,
        uid: member.uid,
        candidate_id: dto.candidate_id,
        ip_address: ip,
        device_fingerprint: dto.device_fingerprint ?? null,
      },
      select: {
        vote_id: true,
        event_id: true,
        candidate_id: true,
        voted_at: true,
        voter_hash: true, // anonymised hash — uid is never returned
      },
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
  private async assertScopeEligibility(
    event: {
      scope_id: number | null;
      scope_only: boolean | null;
      visibility_upward: boolean | null;
    },
    voterScopeId: number,
  ) {
    const eventScopeId = event.scope_id;
    if (eventScopeId === null) return; // org-wide event — always eligible

    // ── Case 1: scope_only ───────────────────────────────────────────────
    if (event.scope_only) {
      if (voterScopeId !== eventScopeId) {
        throw new ForbiddenException(
          'This event is restricted to a specific scope. Your scope is not eligible.',
        );
      }
      return;
    }

    // ── Case 2 & 3: downward (always) + upward (optional) ───────────────
    const descendantRows = await this.prisma.$queryRaw<{ scope_id: number }[]>`
      SELECT scope_id FROM get_scope_descendants(${eventScopeId}::int)
    `;
    const descendants = descendantRows.map((r) => Number(r.scope_id));

    if (descendants.includes(voterScopeId)) return; // eligible via downward

    // ── Case 3: check ancestors if visibility_upward is set ─────────────
    if (event.visibility_upward) {
      const ancestorRows = await this.prisma.$queryRaw<{ scope_id: number }[]>`
        SELECT scope_id FROM get_scope_ancestors(${eventScopeId}::int)
      `;
      const ancestors = ancestorRows.map((r) => Number(r.scope_id));

      if (ancestors.includes(voterScopeId)) return; // eligible via upward
    }

    throw new ForbiddenException(
      'Your scope is not eligible to vote in this event',
    );
  }
}
