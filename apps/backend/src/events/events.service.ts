import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrgService } from '../organization/org.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
// FIX: import canonical JwtUser instead of redefining locally with wrong pid type.
//      JWT payload stores pid as string (auth.service: payload = { pid: user.pid.toString() }).
//      The local interface had pid?: number which is incorrect.
import type { JwtUser } from '../common/decorators/current-user.decorator';
import type { events as PrismaEvent } from '@prisma/client';

@Injectable()
export class EventsService {
  constructor(
    private prisma: PrismaService,
    private orgService: OrgService,
  ) {}

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

    //await this.assertEventVisible(user, event);

    // FIX (finding #5): previously only checked `user.type === 'ORG'`, so
    // has_voted always evaluated to false for UNIFIED sessions — even when
    // that account had actually voted via a linked org identity, since
    // UNIFIED JWTs carry a pid, not a uid. resolveViewerUidInOrg (already
    // used by assertEventVisible below) resolves the correct uid for both
    // session types: it returns the ORG session's own uid directly, or hops
    // pid -> org_members -> uid for UNIFIED sessions via resolveOrgIdentities.
    let has_voted = false;
    const viewerUid = await this.resolveViewerUidInOrg(user, event.orgid ?? '');
    if (viewerUid) {
      const ep = await this.prisma.event_participants.findFirst({
        where: { event_id: eventId, orgid: event.orgid!, uid: viewerUid },
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
    // FIX (Phase 2b): the old assertOrgIdentity() was a no-op for UNIFIED
    // sessions, so dto.orgid/dto.uid were trusted verbatim from the request
    // body. The member_roles check below only confirms *some* member holds
    // that uid+organizer role in that org — it does NOT confirm the caller
    // themselves is linked to that uid. A UNIFIED caller could previously
    // supply any real organizer's uid (their own org or another org
    // entirely) and pass straight through, impersonating that organizer to
    // create events in their name. Resolving the caller's identity first —
    // and requiring dto.uid to match it — closes that gap.
    const callerUid = await this.resolveCallerIdentityInOrg(
      user,
      dto.orgid,
      dto.uid,
    );
    if (callerUid !== dto.uid) {
      throw new ForbiddenException(
        'Action not permitted for your current session identity',
      );
    }

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

    await this.assertCallerOwnsEvent(user, event);
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

    await this.assertCallerOwnsEvent(user, event);
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

    // FIX (Phase 2b): previously hard-blocked any non-ORG session type
    // (`user.type !== 'ORG'`), so UNIFIED-session organizers could never
    // view participant lists for orgs they legitimately organize. Now
    // resolves the caller's identity against the EVENT's actual orgid,
    // using the same pattern as updateEvent/deleteEvent (Phase 2a) —
    // instead of trusting `user.orgid` (which doesn't even exist on a
    // UNIFIED session).
    const orgid = event.orgid ?? '';
    const callerUid = await this.resolveCallerIdentityInOrg(user, orgid);

    const role = await this.prisma.member_roles.findFirst({
      where: { orgid, uid: callerUid, is_organizer: true },
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

  /**
   * Resolves the uid the caller is actually allowed to act as within
   * `orgid`, safely for both session types.
   *
   * IMPORTANT: OrgService.resolveCallerUid() trusts its `orgid` argument
   * unconditionally for ORG sessions — it just returns `user.uid` without
   * ever checking that arg against `user.orgid`. So callers here MUST
   * confirm an ORG session's own orgid actually equals the target `orgid`
   * *before* calling it. For UNIFIED sessions, resolveCallerUid does the
   * real work of verifying the caller's pid is linked (via org_members) to
   * a uid in `orgid` — and, if `requestedUid` is supplied, that it actually
   * belongs to the caller rather than being trusted from the request body.
   *
   * Used by assertCallerOwnsEvent (update/delete), getParticipants, and
   * createEvent, so the same cross-org IDOR fix from Phase 2a is applied
   * consistently everywhere caller identity needs resolving.
   */
  private async resolveCallerIdentityInOrg(
    user: JwtUser,
    orgid: string,
    requestedUid?: string,
  ): Promise<string> {
    if (user.type === 'ORG' && user.orgid !== orgid) {
      throw new ForbiddenException(
        'Action not permitted for your current session identity',
      );
    }
    return requestedUid !== undefined
      ? this.orgService.resolveCallerUid(user, orgid, requestedUid)
      : this.orgService.resolveCallerUid(user, orgid);
  }

  /**
   * FIX (cross-org IDOR, Phase 2a): verifies the caller's resolved
   * org-identity for the EVENT's actual orgid matches the event's
   * created_by_uid. For ORG sessions this is equivalent to the old check.
   * For UNIFIED sessions this now actually resolves the caller's uid via
   * pid → org_members (same pattern as RolesGuard/OrgService
   * .resolveCallerUid), instead of the prior no-op that let any UNIFIED
   * organizer mutate any org's events.
   */
  private async assertCallerOwnsEvent(user: JwtUser, event: PrismaEvent) {
    const orgid = event.orgid ?? '';
    const callerUid = await this.resolveCallerIdentityInOrg(user, orgid);
    if (callerUid !== event.created_by_uid) {
      throw new ForbiddenException(
        'Action not permitted for your current session identity',
      );
    }
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
    // FIX: previously passed user.uid straight through, but uid is only
    // ever populated on ORG-session JWTs. UNIFIED sessions carry a pid
    // instead, so this always evaluated as uid=undefined for them —
    // get_visible_events() then returns zero rows and every UNIFIED user
    // gets falsely told an event (including ones they've already voted
    // in) isn't visible to their account. Resolve the caller's real uid
    // for this event's org first, same pattern as resolveOrgIdentities /
    // resolveCallerIdentityInOrg used elsewhere in this file.
    const uid = await this.resolveViewerUidInOrg(user, event.orgid ?? '');

    // FIX: get_visible_events() in the database is
    // get_visible_events(p_orgid VARCHAR, p_scope INT) — it takes a
    // scope_id, not a uid. Calling it with (orgid::text, uid::text) has
    // no matching overload and throws Postgres 42883 / Prisma P2010
    // ("function get_visible_events(text, text) does not exist") on
    // every call, so getResults() was 500ing for everyone. Resolve the
    // caller's scope_id in this org (via member_roles) and pass that.
    if (!uid) {
      throw new ForbiddenException('Event not visible to your account');
    }
    const role = await this.prisma.member_roles.findFirst({
      where: { orgid: event.orgid ?? '', uid },
    });
    if (!role) {
      throw new ForbiddenException('Event not visible to your account');
    }

    const rows = await this.prisma.$queryRaw<{ event_id: number }[]>`
    SELECT event_id 
    FROM get_visible_events(${event.orgid}::varchar, ${role.scope_id}::int)
    WHERE event_id = ${event.event_id}::int
  `;
    if (rows.length === 0) {
      throw new ForbiddenException('Event not visible to your account');
    }
  }

  /**
   * Resolves the uid the caller should be evaluated as for visibility
   * checks against a specific org's event.
   * - ORG session    → its own uid, but only if it actually belongs to
   *                     this orgid (an ORG session for a different org
   *                     must not be evaluated under this org's uid).
   * - UNIFIED session → the org_members-linked uid for this orgid, via
   *                     resolveOrgIdentities (handles the pid → uid hop).
   * - GOV session, or no matching org identity → undefined; the caller
   *                     has no org-scoped uid here, so get_visible_events
   *                     will correctly find nothing unless the event is
   *                     visible independent of org membership.
   */
  private async resolveViewerUidInOrg(
    user: JwtUser,
    orgid: string,
  ): Promise<string | undefined> {
    if (user.type === 'ORG') {
      return user.orgid === orgid ? user.uid : undefined;
    }
    const identities = await this.resolveOrgIdentities(user);
    return identities.find((i) => i.orgid === orgid)?.uid;
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
