import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddCandidateDto } from './dto/add-candidate.dto';
// Removed local JwtUser interface (had pid?: number — wrong; JWT stores it as string).
//      Import canonical JwtUser from the decorator instead.
import type { JwtUser } from '../common/decorators/current-user.decorator';
import { EventsService } from './events.service';

@Injectable()
export class CandidatesService {
  constructor(
    private prisma: PrismaService,
    // Inject EventsService to reuse resolveOrgIdentities for UNIFIED sessions
    //      rather than duplicating or mishandling the logic.
    private eventsService: EventsService,
  ) {}

  async addCandidate(user: JwtUser, eventId: number, dto: AddCandidateDto) {
    await this.assertOrganizerAndNotStarted(user, eventId);

    const dup = await this.prisma.candidates.findFirst({
      where: { event_id: eventId, candidate_name: dto.candidate_name },
    });
    if (dup)
      throw new BadRequestException(
        'Candidate name already exists in this event',
      );

    const candidate = await this.prisma.candidates.create({
      data: {
        event_id: eventId,
        candidate_name: dto.candidate_name,
        description: dto.description ?? null,
      },
    });

    // Seed vote_results row so this candidate appears in results with 0 votes
    await this.prisma.vote_results.create({
      data: {
        event_id: eventId,
        candidate_id: candidate.candidate_id,
        vote_count: 0,
      },
    });

    return candidate;
  }

  async removeCandidate(user: JwtUser, eventId: number, candidateId: number) {
    await this.assertOrganizerAndNotStarted(user, eventId);

    const candidate = await this.prisma.candidates.findFirst({
      where: { candidate_id: candidateId, event_id: eventId },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    // Ensure at least 2 candidates remain after deletion
    const count = await this.prisma.candidates.count({
      where: { event_id: eventId },
    });
    if (count <= 2) {
      throw new BadRequestException('An event must have at least 2 candidates');
    }

    await this.prisma.vote_results.deleteMany({
      where: { event_id: eventId, candidate_id: candidateId },
    });
    await this.prisma.candidates.delete({
      where: { candidate_id: candidateId },
    });

    return { message: 'Candidate removed' };
  }

  async updateCandidate(
    user: JwtUser,
    eventId: number,
    candidateId: number,
    dto: AddCandidateDto,
  ) {
    await this.assertOrganizerAndNotStarted(user, eventId);

    const candidate = await this.prisma.candidates.findFirst({
      where: { candidate_id: candidateId, event_id: eventId },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    const updated = await this.prisma.candidates.update({
      where: { candidate_id: candidateId },
      data: {
        candidate_name: dto.candidate_name,
        description: dto.description ?? null,
      },
    });

    return updated;
  }

  // ─── Helper ──────────────────────────────────────────────────────────────

  /**
   * Asserts:
   *   1. The event exists and has not yet started.
   *   2. The calling user is an organizer in the event's org.
   *
   * Uses EventsService.resolveOrgIdentities to get every (orgid, uid) pair
   * the caller can act as, then checks for an organizer role on any match in
   * the event's org. This handles both ORG and UNIFIED sessions. Falling back
   * to event.created_by_uid for non-ORG sessions would be wrong: any UNIFIED
   * session would pass as long as the event's creator held a role.
   */
  private async assertOrganizerAndNotStarted(user: JwtUser, eventId: number) {
    const event = await this.prisma.events.findFirst({
      where: { event_id: eventId, is_deleted: false },
    });
    if (!event) throw new NotFoundException('Event not found');

    if (new Date() >= event.start_time) {
      throw new BadRequestException(
        'Cannot modify candidates after event has started',
      );
    }

    // Resolve all (orgid, uid) pairs this caller can act as
    const identities = await this.eventsService.resolveOrgIdentities(user);

    // Find a matching identity that is also an organizer in event.orgid
    const matched = await Promise.all(
      identities
        .filter((id) => id.orgid === event.orgid)
        .map(async (id) => {
          const role = await this.prisma.member_roles.findFirst({
            where: { orgid: id.orgid, uid: id.uid, is_organizer: true },
          });
          return role ? id : null;
        }),
    );

    const authorized = matched.find(Boolean);
    if (!authorized) {
      throw new ForbiddenException(
        "You must be an organizer in this event's org to manage candidates",
      );
    }

    return event;
  }
}
