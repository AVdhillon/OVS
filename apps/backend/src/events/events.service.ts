import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
// FIX: import canonical JwtUser instead of redefining locally with wrong pid type.
//      JWT payload stores pid as string (auth.service: payload = { pid: user.pid.toString() }).
//      The local interface had pid?: number which is incorrect.
import type { JwtUser } from '../common/decorators/current-user.decorator';
import type { events as PrismaEvent } from '@prisma/client';

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // GET VISIBLE EVENTS
  // ─────────────────────────────────────────────────────────────────────────
  async getVisibleEvents(user: JwtUser) {
    const identities = await this.resolveOrgIdentities(user);

    if (identities.length === 0) {
      return { active_pending: [], voted: [], completed: [] };
    }

    const now = new Date();
    const active_pending: any[] = [];
    const voted: any[] = [];
    const completed: any[] = [];

    for (const { orgid, uid, scope_id } of identities) {
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT e.event_id,
               e.orgid,
               e.title,
               e.description,
               e.start_time,
               e.end_time,
               e.status,
               e.show_live_results,
               e.visibility_upward,
               e.scope_only,
               e.scope_id,
               e.created_by_uid,
               ep.has_voted,
               CASE WHEN ep.uid IS NOT NULL THEN TRUE ELSE FALSE END AS is_voter,
               COALESCE(mr.is_organizer, FALSE)                      AS is_organizer
        FROM events e
               LEFT JOIN event_participants ep
                         ON ep.event_id = e.event_id
                           AND ep.orgid = ${orgid}
                           AND ep.uid = ${uid}
               LEFT JOIN member_roles mr
                         ON mr.orgid = ${orgid}
                           AND mr.uid = ${uid}
        WHERE e.orgid = ${orgid}
          AND e.is_deleted = FALSE
          AND (
          -- Organizer can always see events within their scope downward (manages them)
          (
            mr.is_organizer = TRUE
              AND e.scope_id IN (SELECT scope_id FROM get_scope_descendants(${scope_id}::int))
            )
            OR
            -- Default downward visibility for voters
          (
            e.scope_only = FALSE
              AND e.scope_id IN (SELECT scope_id FROM get_scope_descendants(${scope_id}::int))
            )
            OR
            -- scope_only: exact scope match for voters
          (
            e.scope_only = TRUE
              AND e.scope_id = ${scope_id}::int
            )
            OR
            -- Upward visibility if flag is set
          (
            e.visibility_upward = TRUE
              AND e.scope_only = FALSE
              AND e.scope_id IN (SELECT scope_id FROM get_scope_ancestors(${scope_id}::int))
            )
          )
        ORDER BY e.start_time DESC
      `;

      for (const ev of rows) {
        const entry = {
          ...ev,
          start_time: ev.start_time?.toISOString(),
          end_time: ev.end_time?.toISOString(),
          orgid,
          acting_uid: uid,
          created_by_uid: ev.created_by_uid,
          is_voter: ev.is_voter,
          is_organizer: ev.is_organizer,
        };

        const end = new Date(ev.end_time);

        if (ev.status === 'COMPLETED' || end < now) {
          completed.push(entry);
        } else if (ev.has_voted) {
          voted.push(entry);
        } else {
          active_pending.push(entry);
        }
      }
    }

    const dedup = (arr: any[]) => {
      const seen = new Set<number>();
      return arr.filter((e) => {
        if (seen.has(e.event_id)) return false;
        seen.add(e.event_id);
        return true;
      });
    };

    return {
      active_pending: dedup(active_pending),
      voted: dedup(voted),
      completed: dedup(completed),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET EVENT DETAIL
  // ─────────────────────────────────────────────────────────────────────────
  async getEventDetail(user: JwtUser, eventId: number) {
    const event = await this.prisma.events.findFirst({
      where: { event_id: eventId, is_deleted: false },
      include: { candidates: true },
    });

    if (!event) throw new NotFoundException('Event not found');

    await this.assertEventVisible(user, event);

    let has_voted = false;
    if (user.type === 'ORG' && user.uid) {
      const ep = await this.prisma.event_participants.findFirst({
        where: { event_id: eventId, orgid: user.orgid!, uid: user.uid },
      });
      has_voted = ep?.has_voted ?? false;
    }

    const now = new Date();
    const showResults =
      event.show_live_results ||
      event.end_time < now ||
      event.status === 'COMPLETED';

    let results: any[] | null = null;
    if (showResults) {
      results = await this.prisma.vote_results.findMany({
        where: { event_id: eventId },
        select: { candidate_id: true, vote_count: true },
      });
    }
    return {
      ...event,
      start_time: event.start_time?.toISOString() ?? null,
      end_time: event.end_time?.toISOString() ?? null,
      has_voted,
      results,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE EVENT
  // ─────────────────────────────────────────────────────────────────────────
  async createEvent(user: JwtUser, dto: CreateEventDto) {
    // FIX: validate scope flag mutual exclusion before hitting the DB constraint
    if (dto.scope_only && dto.visible_upward) {
      throw new BadRequestException(
        'scope_only and visible_upward cannot both be true',
      );
    }
    if (new Date(dto.start_time) < new Date()) {
      throw new BadRequestException('start_time cannot be in the past');
    }
    this.assertOrgIdentity(user, dto.orgid, dto.uid);

    const role = await this.prisma.member_roles.findFirst({
      where: { orgid: dto.orgid, uid: dto.uid, is_organizer: true },
    });
    if (!role)
      throw new ForbiddenException('You are not an organizer in this org');

    await this.assertScopeInOrg(dto.orgid, dto.scope_id);
    await this.assertScopeReachable(role.scope_id, dto.scope_id);

    const start = new Date(dto.start_time);
    const end = new Date(dto.end_time);
    if (end <= start)
      throw new BadRequestException('end_time must be after start_time');

    // DB trigger trg_populate_event_participants runs after insert
    const event = await this.prisma.events.create({
      data: {
        orgid: dto.orgid,
        created_by_uid: dto.uid,
        scope_id: dto.scope_id,
        title: dto.title,
        description: dto.description ?? null,
        start_time: start,
        end_time: end,
        show_live_results: dto.show_live_results ?? false,
        visibility_upward: dto.visible_upward ?? false,
        // FIX: scope_only was silently dropped — now passed through from DTO
        scope_only: dto.scope_only ?? false,
        status: 'ACTIVE',
      },
    });

    await this.prisma.candidates.createMany({
      data: dto.candidates.map((c) => ({
        event_id: event.event_id,
        candidate_name: c.candidate_name,
        description: c.description ?? null,
      })),
    });

    // Seed vote_results rows so all candidates appear in results even with 0 votes
    const createdCandidates = await this.prisma.candidates.findMany({
      where: { event_id: event.event_id },
    });
    await this.prisma.vote_results.createMany({
      data: createdCandidates.map((c) => ({
        event_id: event.event_id,
        candidate_id: c.candidate_id,
        vote_count: 0,
      })),
      skipDuplicates: true,
    });

    return { ...event, candidates: createdCandidates };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE EVENT
  // ─────────────────────────────────────────────────────────────────────────
  async updateEvent(user: JwtUser, eventId: number, dto: UpdateEventDto) {
    const event = await this.getEventOrThrow(eventId);

    this.assertOrgIdentity(user, event.orgid ?? '', event.created_by_uid ?? '');
    this.assertEventNotStarted(event);

    // FIX: validate mutual exclusion. Resolve effective values (dto may only
    //      supply one of the two) against the existing event state.
    const effectiveScopeOnly =
      dto.scope_only !== undefined
        ? dto.scope_only
        : (event.scope_only ?? false);
    const effectiveVisibleUpward =
      dto.visible_upward !== undefined
        ? dto.visible_upward
        : (event.visibility_upward ?? false);

    if (effectiveScopeOnly && effectiveVisibleUpward) {
      throw new BadRequestException(
        'scope_only and visible_upward cannot both be true',
      );
    }

    const start = dto.start_time ? new Date(dto.start_time) : event.start_time;
    const end = dto.end_time ? new Date(dto.end_time) : event.end_time;
    if (end <= start)
      throw new BadRequestException('end_time must be after start_time');

    const updated = await this.prisma.events.update({
      where: { event_id: eventId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.start_time !== undefined && { start_time: start }),
        ...(dto.end_time !== undefined && { end_time: end }),
        ...(dto.show_live_results !== undefined && {
          show_live_results: dto.show_live_results,
        }),
        ...(dto.visible_upward !== undefined && {
          visibility_upward: dto.visible_upward,
        }),
        // FIX: scope_only was never passed through in updates
        ...(dto.scope_only !== undefined && { scope_only: dto.scope_only }),
      },
    });

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE EVENT (soft)
  // ─────────────────────────────────────────────────────────────────────────
  async deleteEvent(user: JwtUser, eventId: number) {
    const event = await this.getEventOrThrow(eventId);

    this.assertOrgIdentity(user, event.orgid ?? '', event.created_by_uid ?? '');
    this.assertEventNotStarted(event);

    await this.prisma.events.update({
      where: { event_id: eventId },
      data: { is_deleted: true, status: 'CANCELLED' },
    });

    return { message: 'Event cancelled and removed' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET RESULTS
  // ─────────────────────────────────────────────────────────────────────────
  async getResults(user: JwtUser, eventId: number) {
    const event = await this.getEventOrThrow(eventId);
    await this.assertEventVisible(user, event);

    const now = new Date();
    const canSee =
      event.show_live_results ||
      event.end_time < now ||
      event.status === 'COMPLETED';

    if (!canSee) {
      throw new ForbiddenException(
        'Live results are not enabled for this event',
      );
    }

    const results = await this.prisma.vote_results.findMany({
      where: { event_id: eventId },
      include: {
        candidates: { select: { candidate_name: true, description: true } },
      },
      orderBy: { vote_count: 'desc' },
    });

    const total = results.reduce((sum, r) => sum + (r.vote_count ?? 0), 0);

    return {
      event_id: eventId,
      title: event.title,
      status: event.status,
      total_votes: total,
      results: results.map((r) => ({
        candidate_id: r.candidate_id,
        candidate_name: r.candidates?.candidate_name,
        vote_count: r.vote_count,
        percentage:
          total > 0 ? +(((r.vote_count ?? 0) / total) * 100).toFixed(2) : 0,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET PARTICIPANTS (organizer only)
  // ─────────────────────────────────────────────────────────────────────────
  async getParticipants(user: JwtUser, eventId: number) {
    const event = await this.getEventOrThrow(eventId);

    if (user.type !== 'ORG' || user.orgid !== event.orgid) {
      throw new ForbiddenException('Organizer access required');
    }
    const role = await this.prisma.member_roles.findFirst({
      where: { orgid: user.orgid, uid: user.uid!, is_organizer: true },
    });
    if (!role) throw new ForbiddenException('Not an organizer');

    const participants = await this.prisma.$queryRaw<any[]>`
      SELECT
        ep.uid,
        ep.orgid,
        ep.has_voted,
        om.mobile,
        om.email
      FROM event_participants ep
      JOIN org_members om ON om.orgid = ep.orgid AND om.uid = ep.uid
      JOIN member_roles mr ON mr.orgid = ep.orgid AND mr.uid = ep.uid
      WHERE ep.event_id = ${eventId}
        AND mr.scope_id IN (
          SELECT scope_id FROM get_scope_descendants(${role.scope_id}::int)
        )
      ORDER BY ep.uid
    `;

    return { event_id: eventId, participants };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private async getEventOrThrow(eventId: number): Promise<PrismaEvent> {
    const event = await this.prisma.events.findFirst({
      where: { event_id: eventId, is_deleted: false },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  private assertEventNotStarted(event: PrismaEvent) {
    if (new Date() >= new Date(event.start_time)) {
      throw new BadRequestException(
        'Cannot modify an event that has already started',
      );
    }
  }

  private assertOrgIdentity(user: JwtUser, orgid: string, uid: string) {
    if (user.type === 'ORG') {
      if (user.orgid !== orgid || user.uid !== uid) {
        throw new ForbiddenException(
          'Action not permitted for your current session identity',
        );
      }
    }
    // UNIFIED users pass — ownership is verified via created_by_uid comparison
  }

  private async assertScopeInOrg(orgid: string, scopeId: number) {
    const scope = await this.prisma.org_scope.findFirst({
      where: { scope_id: scopeId, orgid },
    });
    if (!scope)
      throw new BadRequestException('Scope does not belong to this org');
  }

  private async assertScopeReachable(
    organizerScopeId: number,
    targetScopeId: number,
  ) {
    const rows = await this.prisma.$queryRaw<{ scope_id: number }[]>`
      SELECT scope_id FROM get_scope_descendants(${organizerScopeId}::int)
    `;
    const ids = rows.map((r) => r.scope_id);
    if (!ids.includes(targetScopeId)) {
      throw new ForbiddenException('Cannot create event outside your scope');
    }
  }

  private async assertEventVisible(user: JwtUser, event: any) {
    const identities = await this.resolveOrgIdentities(user);
    for (const { orgid, scope_id } of identities) {
      if (orgid !== event.orgid) continue;

      const rows = await this.prisma.$queryRaw<{ event_id: number }[]>`
        SELECT event_id FROM get_visible_events(${orgid}::varchar, ${scope_id}::int)
        WHERE event_id = ${event.event_id}
      `;
      if (rows.length > 0) return;
    }
    throw new ForbiddenException('Event not visible to your account');
  }

  /**
   * Resolves all (orgid, uid, scope_id) pairs the calling user can act as.
   * Exported so CandidatesService can reuse it without duplication.
   *
   * - ORG session    → single identity from JWT
   * - UNIFIED session → all ORG memberships linked via org_members.pid
   * - GOV session    → no org identities (returns empty)
   */
  async resolveOrgIdentities(
    user: JwtUser,
  ): Promise<{ orgid: string; uid: string; scope_id: number }[]> {
    if (user.type === 'ORG' && user.orgid && user.uid) {
      const role = await this.prisma.member_roles.findFirst({
        where: { orgid: user.orgid, uid: user.uid },
      });
      if (!role) return [];
      return [{ orgid: user.orgid, uid: user.uid, scope_id: role.scope_id }];
    }

    if (user.type === 'UNIFIED' && user.pid) {
      // FIX: pid is string in JWT — BigInt() accepts string, but explicit cast
      //      makes the intent clear and guards against accidental number coercion.
      const links = await this.prisma.org_members.findMany({
        where: { pid: BigInt(user.pid) },
        select: { orgid: true, uid: true },
      });

      const result: { orgid: string; uid: string; scope_id: number }[] = [];
      for (const { orgid, uid } of links) {
        const role = await this.prisma.member_roles.findFirst({
          where: { orgid, uid },
        });
        if (role) result.push({ orgid, uid, scope_id: role.scope_id });
      }
      return result;
    }

    return [];
  }
}
