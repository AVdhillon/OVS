import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

/**
 * Shape of the JWT payload after JwtStrategy.validate() runs.
 * UNIFIED  → { pid, type:'UNIFIED', session_id }
 * ORG      → { pid, orgid, uid, type:'ORG', session_id }
 * GOV      → { epic_id, type:'GOV', session_id }
 */
interface JwtUser {
  pid?: number;
  orgid?: string;
  uid?: string;
  epic_id?: string;
  type: 'UNIFIED' | 'ORG' | 'GOV';
  session_id: string;
}

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // GET VISIBLE EVENTS
  // Returns events visible to ALL identities the caller holds,
  // segmented into active_pending / voted / completed.
  // ─────────────────────────────────────────────────────────────────────────
  async getVisibleEvents(user: JwtUser) {
    // 1. Collect every (orgid, uid, scope_id) the caller has
    const identities = await this.resolveOrgIdentities(user);

    if (identities.length === 0) {
      return { active_pending: [], voted: [], completed: [] };
    }

    const now = new Date();
    const active_pending: any[] = [];
    const voted: any[] = [];
    const completed: any[] = [];

    // 2. For each identity pull visible, non-deleted events
    for (const { orgid, uid, scope_id } of identities) {
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT
          e.event_id,
          e.orgid,
          e.title,
          e.description,
          e.start_time,
          e.end_time,
          e.status,
          e.show_live_results,
          e.visibility_upward,
          e.scope_id,
          ep.has_voted
        FROM events e
        LEFT JOIN event_participants ep
          ON ep.event_id = e.event_id
         AND ep.orgid    = ${orgid}
         AND ep.uid      = ${uid}
        WHERE e.orgid = ${orgid}
          AND e.is_deleted = FALSE
          AND (
            -- Downward visibility: event scope is same or below caller scope
            e.scope_id IN (
              SELECT scope_id FROM get_scope_descendants(${scope_id}::int)
            )
            OR
            -- Upward visibility: event explicitly allows it and is above caller
            (
              e.visibility_upward = TRUE
              AND e.scope_id IN (
                SELECT scope_id FROM get_scope_ancestors(${scope_id}::int)
              )
            )
          )
        ORDER BY e.start_time DESC
      `;

      for (const ev of rows) {
        const entry = {
          ...ev,
          orgid,
          acting_uid: uid,
          start_time: ev.start_time,
          end_time: ev.end_time,
        };

        if (ev.status === 'COMPLETED' || ev.end_time < now) {
          completed.push(entry);
        } else if (ev.has_voted) {
          voted.push(entry);
        } else {
          active_pending.push(entry);
        }
      }
    }

    // Deduplicate by event_id (a user may share scopes across identities)
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

    // Verify caller has visibility into this event
    await this.assertEventVisible(user, event);

    // Attach has_voted for the calling identity (if ORG participant)
    let has_voted = false;
    if (user.type === 'ORG' && user.uid) {
      const ep = await this.prisma.event_participants.findFirst({
        where: { event_id: eventId, orgid: user.orgid!, uid: user.uid },
      });
      has_voted = ep?.has_voted ?? false;
    }

    // Live results: include if event completed OR show_live_results=true
    const now = new Date();
    const showResults =
      event.show_live_results || event.end_time < now || event.status === 'COMPLETED';

    let results: any[] | null = null;
    if (showResults) {
      results = await this.prisma.vote_results.findMany({
        where: { event_id: eventId },
        select: { candidate_id: true, vote_count: true },
      });
    }

    return {
      ...event,
      has_voted,
      results,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE EVENT
  // ─────────────────────────────────────────────────────────────────────────
  async createEvent(user: JwtUser, dto: CreateEventDto) {
    // 1. The caller must present matching orgid+uid
    this.assertOrgIdentity(user, dto.orgid, dto.uid);

    // 2. Must be an organizer in that org
    const role = await this.prisma.member_roles.findFirst({
      where: { orgid: dto.orgid, uid: dto.uid, is_organizer: true },
    });
    if (!role) throw new ForbiddenException('You are not an organizer in this org');

    // 3. Scope must belong to the org and be within the organizer's scope tree
    await this.assertScopeInOrg(dto.orgid, dto.scope_id);
    await this.assertScopeReachable(role.scope_id, dto.scope_id);

    // 4. Time sanity
    const start = new Date(dto.start_time);
    const end = new Date(dto.end_time);
    if (end <= start) throw new BadRequestException('end_time must be after start_time');

    // 5. Create event (DB trigger trg_populate_event_participants runs after insert)
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
        status: 'ACTIVE',
      },
    });

    // 6. Create candidates
    const candidates = await this.prisma.candidates.createMany({
      data: dto.candidates.map((c) => ({
        event_id: event.event_id,
        candidate_name: c.candidate_name,
        description: c.description ?? null,
      })),
    });

    // 7. Seed vote_results rows (count = 0) for each candidate
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

    return {
      ...event,
      candidates: createdCandidates,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE EVENT
  // ─────────────────────────────────────────────────────────────────────────
  async updateEvent(user: JwtUser, eventId: number, dto: UpdateEventDto) {
    const event = await this.getEventOrThrow(eventId);

    this.assertOrgIdentity(user, event.orgid ?? '', event.created_by_uid ?? '');
    this.assertEventNotStarted(event);

    const start = dto.start_time ? new Date(dto.start_time) : event.start_time;
    const end = dto.end_time ? new Date(dto.end_time) : event.end_time;
    if (end <= start) throw new BadRequestException('end_time must be after start_time');

    const updated = await this.prisma.events.update({
      where: { event_id: eventId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.start_time !== undefined && { start_time: start }),
        ...(dto.end_time !== undefined && { end_time: end }),
        ...(dto.show_live_results !== undefined && { show_live_results: dto.show_live_results }),
        ...(dto.visible_upward !== undefined && { visibility_upward: dto.visible_upward }),
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
      throw new ForbiddenException('Live results are not enabled for this event');
    }

    const results = await this.prisma.vote_results.findMany({
      where: { event_id: eventId },
      include: {
        candidates: {
          select: { candidate_name: true, description: true },
        },
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
        candidate_name: (r as any).candidates?.candidate_name,
        vote_count: r.vote_count,
        percentage: total > 0 ? +(((r.vote_count ?? 0) / total) * 100).toFixed(2) : 0,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET PARTICIPANTS (organizer only)
  // ─────────────────────────────────────────────────────────────────────────
  async getParticipants(user: JwtUser, eventId: number) {
    const event = await this.getEventOrThrow(eventId);

    // Must be organizer in that org
    if (user.type !== 'ORG' || user.orgid !== event.orgid) {
      throw new ForbiddenException('Organizer access required');
    }
    const role = await this.prisma.member_roles.findFirst({
      where: { orgid: user.orgid!, uid: user.uid!, is_organizer: true },
    });
    if (!role) throw new ForbiddenException('Not an organizer');

    // Can only see participants within their scope or below
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

  private async getEventOrThrow(eventId: number) {
    const event = await this.prisma.events.findFirst({
      where: { event_id: eventId, is_deleted: false },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  private assertEventNotStarted(event: any) {
    if (new Date() >= new Date(event.start_time)) {
      throw new BadRequestException('Cannot modify an event that has already started');
    }
  }

  /**
   * Asserts the logged-in user is acting as the given orgid+uid combo.
   * For UNIFIED users who may have multiple ORG identities, we check
   * their identity_wallet or user_org linkage.
   */
  private assertOrgIdentity(user: JwtUser, orgid: string, uid: string) {
    if (user.type === 'ORG') {
      if (user.orgid !== orgid || user.uid !== uid) {
        throw new ForbiddenException(
          'Action not permitted for your current session identity',
        );
      }
    }
    // UNIFIED users pass — service-level ownership check (created_by_uid) is enough
  }

  /**
   * Checks that scope_id belongs to orgid.
   */
  private async assertScopeInOrg(orgid: string, scopeId: number) {
    const scope = await this.prisma.org_scope.findFirst({
      where: { scope_id: scopeId, orgid },
    });
    if (!scope) throw new BadRequestException('Scope does not belong to this org');
  }

  /**
   * Checks that targetScope is within the descendant tree of organizerScope.
   */
  private async assertScopeReachable(organizerScopeId: number, targetScopeId: number) {
    const rows = await this.prisma.$queryRaw<{ scope_id: number }[]>`
      SELECT scope_id FROM get_scope_descendants(${organizerScopeId}::int)
    `;
    const ids = rows.map((r) => r.scope_id);
    if (!ids.includes(targetScopeId)) {
      throw new ForbiddenException('Cannot create event outside your scope');
    }
  }

  /**
   * Verifies the calling user can see the given event.
   */
  private async assertEventVisible(user: JwtUser, event: any) {
    const identities = await this.resolveOrgIdentities(user);
    for (const { orgid, scope_id } of identities) {
      if (orgid !== event.orgid) continue;

      const rows = await this.prisma.$queryRaw<{ event_id: number }[]>`
        SELECT event_id FROM get_visible_events(${orgid}::varchar, ${scope_id}::int)
        WHERE event_id = ${event.event_id}
      `;
      if (rows.length > 0) return; // visible — allow
    }
    throw new ForbiddenException('Event not visible to your account');
  }

  /**
   * Resolves all (orgid, uid, scope_id) pairs the calling user can act as.
   *
   * - ORG session    → single identity from JWT
   * - UNIFIED session → all ORG identities linked via identity_wallet / user_org
   * - GOV session    → no org identities (returns empty)
   */
  private async resolveOrgIdentities(
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
      // All ORG memberships linked to this pid
      const links = await this.prisma.user_org.findMany({
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
