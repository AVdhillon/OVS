import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddCandidateDto } from './dto/add-candidate.dto';

interface JwtUser {
  pid?: number;
  orgid?: string;
  uid?: string;
  type: 'UNIFIED' | 'ORG' | 'GOV';
}

@Injectable()
export class CandidatesService {
  constructor(private prisma: PrismaService) {}

  async addCandidate(user: JwtUser, eventId: number, dto: AddCandidateDto) {
    const event = await this.assertOrganizerAndNotStarted(user, eventId);

    // Check name uniqueness within event
    const dup = await this.prisma.candidates.findFirst({
      where: { event_id: eventId, candidate_name: dto.candidate_name },
    });
    if (dup) throw new BadRequestException('Candidate name already exists in this event');

    const candidate = await this.prisma.candidates.create({
      data: {
        event_id: eventId,
        candidate_name: dto.candidate_name,
        description: dto.description ?? null,
      },
    });

    // Seed vote_results row
    await this.prisma.vote_results.create({
      data: { event_id: eventId, candidate_id: candidate.candidate_id, vote_count: 0 },
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
    const count = await this.prisma.candidates.count({ where: { event_id: eventId } });
    if (count <= 2) {
      throw new BadRequestException('An event must have at least 2 candidates');
    }

    await this.prisma.vote_results.deleteMany({
      where: { event_id: eventId, candidate_id: candidateId },
    });
    await this.prisma.candidates.delete({ where: { candidate_id: candidateId } });

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

  private async assertOrganizerAndNotStarted(user: JwtUser, eventId: number) {
    const event = await this.prisma.events.findFirst({
      where: { event_id: eventId, is_deleted: false },
    });
    if (!event) throw new NotFoundException('Event not found');

    if (new Date() >= event.start_time) {
      throw new BadRequestException('Cannot modify candidates after event has started');
    }

    // Must be the creator's org and have organizer role
    const actingUid = user.type === 'ORG' ? user.uid : null;
    const actingOrgid = user.type === 'ORG' ? user.orgid : null;

    // For UNIFIED sessions, allow if they created the event
    if (
      user.type === 'ORG' &&
      (actingOrgid !== event.orgid || actingUid !== event.created_by_uid)
    ) {
      throw new ForbiddenException('Only the event creator can modify candidates');
    }

    const role = actingUid
      ? await this.prisma.member_roles.findFirst({
          where: { orgid: event.orgid ?? '', uid: actingUid ?? event.created_by_uid ?? '', is_organizer: true },
        })
      : null;

    if (user.type === 'ORG' && !role) {
      throw new ForbiddenException('Organizer role required');
    }

    return event;
  }
}
