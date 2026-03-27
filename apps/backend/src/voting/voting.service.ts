import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CastVoteDto } from './dto/cast-vote.dto';
import type { Request } from 'express';

interface JwtUser {
  pid?: number;
  orgid?: string;
  uid?: string;
  epic_id?: string;
  type: 'UNIFIED' | 'ORG' | 'GOV';
  session_id: string;
}

@Injectable()
export class VotingService {
  constructor(private prisma: PrismaService) {}

  async castVote(user: JwtUser, dto: CastVoteDto, req: Request) {
    // ── 1. Resolve the identity being used to vote ───────────────────────
    //
    // The session type tells us how the user logged in.
    // We validate they have the right to vote as dto.orgid + dto.uid.
    await this.assertVotingIdentity(user, dto.orgid, dto.uid);

    // ── 2. Load the event ────────────────────────────────────────────────
    const event = await this.prisma.events.findFirst({
      where: { event_id: dto.event_id, is_deleted: false },
    });
    if (!event) throw new NotFoundException('Event not found');

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

    // ── 4. Check caller is a participant ────────────────────────────────
    const participant = await this.prisma.event_participants.findFirst({
      where: {
        event_id: dto.event_id,
        orgid: dto.orgid,
        uid: dto.uid,
      },
    });
    if (!participant) {
      throw new ForbiddenException('You are not a participant in this event');
    }

    // ── 5. Check not already voted ───────────────────────────────────────
    if (participant.has_voted) {
      throw new ConflictException('You have already voted in this event');
    }

    // Double-check via votes table as well (race condition guard)
    const existingVote = await this.prisma.votes.findFirst({
      where: { event_id: dto.event_id, orgid: dto.orgid, uid: dto.uid },
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

    // ── 7. Check voter has the voter role ────────────────────────────────
    const role = await this.prisma.member_roles.findFirst({
      where: { orgid: dto.orgid, uid: dto.uid, is_voter: true },
    });
    if (!role) {
      throw new ForbiddenException('Your account does not have voter permissions');
    }

    // ── 8. Check scope eligibility ───────────────────────────────────────
    //   Voter's scope must be within descendants of the event's scope.
    const scopeCheck = await this.prisma.$queryRaw<{ scope_id: number }[]>`
      SELECT scope_id FROM get_scope_descendants(${event.scope_id}::int)
    `;
    const eligibleScopes = scopeCheck.map((r) => r.scope_id);
    if (!eligibleScopes.includes(role.scope_id)) {
      throw new ForbiddenException('Your scope is not eligible for this event');
    }

    // ── 9. Extract IP ────────────────────────────────────────────────────
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      null;

    // ── 10. Insert vote ───────────────────────────────────────────────────
    //  DB triggers will:
    //   • anonymize_vote      — set voter_hash
    //   • trg_vote_count      — increment vote_results
    //   • trg_mark_participant_voted — flip has_voted
    //   • trg_detect_vote_fraud     — log suspicious patterns
    const vote = await this.prisma.votes.create({
      data: {
        event_id: dto.event_id,
        orgid: dto.orgid,
        uid: dto.uid,
        candidate_id: dto.candidate_id,
        ip_address: ip,
        device_fingerprint: dto.device_fingerprint ?? null,
      },
      select: {
        vote_id: true,
        event_id: true,
        candidate_id: true,
        voted_at: true,
        voter_hash: true, // anonymized hash — not uid
      },
    });

    // ── 11. Optionally return live results if enabled ─────────────────────
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
   * Validates that the calling JWT session is permitted to vote as
   * the supplied orgid + uid.
   *
   * Rules:
   *  - ORG session   → must match JWT orgid + uid exactly
   *  - UNIFIED session → pid must be linked to orgid+uid via user_org
   *  - GOV session   → never allowed to vote in org events
   */
  private async assertVotingIdentity(
    user: JwtUser,
    orgid: string,
    uid: string,
  ) {
    if (user.type === 'GOV') {
      throw new ForbiddenException(
        'Government identity cannot vote in org events',
      );
    }

    if (user.type === 'ORG') {
      if (user.orgid !== orgid || user.uid !== uid) {
        throw new ForbiddenException(
          'Voting identity does not match your session',
        );
      }
      return;
    }

    // UNIFIED — check pid → orgid+uid linkage
    if (user.type === 'UNIFIED' && user.pid) {
      const link = await this.prisma.user_org.findFirst({
        where: { pid: BigInt(user.pid), orgid, uid },
      });
      if (!link) {
        throw new ForbiddenException(
          'Your unified account is not linked to this org identity',
        );
      }
      return;
    }

    throw new ForbiddenException('Unable to verify voting identity');
  }
}
