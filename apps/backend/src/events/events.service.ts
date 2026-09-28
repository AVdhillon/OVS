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
// Import canonical JwtUser instead of redefining locally with wrong pid type.
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
    // One identity per member_roles row (orgid, uid, scope_id) — a member who
    // holds several scopes now has each of them evaluated, and the results
    // are merged below.
    const identities = await this.resolveOrgIdentities(user);

    if (identities.length === 0) {
      return { active_pending: [], voted: [], completed: [] };
    }

    const now = new Date();
    // Merge by event_id across every (org, scope) role row. If an event is
    // reachable through more than one scope, is_organizer is true when ANY
    // of those role rows is an organizer role.
    const merged = new Map<number, any>();

    for (const { orgid, uid, scope_id, is_organizer } of identities) {
      // is_organizer comes from the SAME member_roles row as scope_id (passed
      // in as a parameter) instead of LEFT JOINing member_roles on
      // (orgid, uid) alone, which paired one row's organizer flag with a
      // different row's scope.
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
               ${is_organizer}::boolean                              AS is_organizer
        FROM events e
               LEFT JOIN event_participants ep
                         ON ep.event_id = e.event_id
                           AND ep.orgid = ${orgid}
                           AND ep.uid = ${uid}
        WHERE e.orgid = ${orgid}
          AND e.is_deleted = FALSE
          AND (
          -- Organizer can always see events within their scope downward (manages them)
          (
            ${is_organizer}::boolean = TRUE
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
        const existing = merged.get(ev.event_id);
        if (existing) {
          existing.is_organizer = existing.is_organizer || ev.is_organizer;
          continue;
        }
        merged.set(ev.event_id, {
          ...ev,
          start_time: ev.start_time?.toISOString(),
          end_time: ev.end_time?.toISOString(),
          orgid,
          acting_uid: uid,
          created_by_uid: ev.created_by_uid,
          is_voter: ev.is_voter,
          is_organizer: ev.is_organizer,
        });
      }
    }

    const active_pending: any[] = [];
    const voted: any[] = [];
    const completed: any[] = [];

    for (const entry of merged.values()) {
      const end = new Date(entry.end_time);

      if (entry.status === 'COMPLETED' || end < now) {
        completed.push(entry);
      } else if (entry.has_voted) {
        voted.push(entry);
      } else {
        active_pending.push(entry);
      }
    }

    // Rows arrive grouped per role row now, so restore the newest-first order.
    const byStartDesc = (x: any, y: any) =>
      String(y.start_time ?? '').localeCompare(String(x.start_time ?? ''));

    return {
      active_pending: active_pending.sort(byStartDesc),
      voted: voted.sort(byStartDesc),
      completed: completed.sort(byStartDesc),
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

    // Visibility is enforced here: without this, any logged-in user could read
    // any event (and its candidates / live results) in any org by id.
    // assertEventVisible applies the same rules as getVisibleEvents, so
    // anything the caller can see in their list can be opened here.
    await this.assertEventVisible(user, event);

    // Checking `user.type === 'ORG'` alone would make has_voted always false
    // for UNIFIED sessions — even when that account had voted via a linked org
    // identity — because UNIFIED JWTs carry a pid, not a uid.
    // resolveViewerUidInOrg (also used by assertEventVisible above) resolves the correct uid for both
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
    // Validate scope flag mutual exclusion before hitting the DB constraint
    if (dto.scope_only && dto.visible_upward) {
      throw new BadRequestException(
        'scope_only and visible_upward cannot both be true',
      );
    }
    if (new Date(dto.start_time) < new Date()) {
      throw new BadRequestException('start_time cannot be in the past');
    }

    // Gate event creation on organization.status. A SUSPENDED/ARCHIVED org
    // shouldn't be able to spin up new events while disabled — checked
    // first, before any org-scoped identity/role queries below, so a
    // caller in a disabled org fails fast rather than paying for those
    // lookups. Queried as its own lookup rather than a Prisma `include`,
    // for the same "unknown real relation field name without the
    // outstanding prisma db pull regen" reason as auth.service.ts's
    // ORG-branch check above and the organization services.
    // NOTE: this is an application-layer check only — the DB trigger
    // check_event_creator() (schema) does not itself verify
    // organization.status; this covers createEvent() here, not a schema
    // edit. Flagged, not fixed: a direct DB write (script/migration/future
    // code path) that bypasses this service could still insert an event
    // for a disabled org.
    const org = await this.prisma.organization.findUnique({
      where: { orgid: dto.orgid },
      select: { status: true },
    });
    if (!org || org.status !== 'ACTIVE') {
      throw new ForbiddenException('This organization is not currently active');
    }

    // The old assertOrgIdentity() was a no-op for UNIFIED
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

    // member_roles' PK is
    // (orgid, uid, scope_id), so a member can legitimately hold the
    // organizer role at more than one scope. The old code did
    // member_roles.findFirst({ is_organizer: true }) and evaluated scope
    // reachability against that ONE arbitrarily-picked row (Postgres gives
    // no ordering guarantee for findFirst without an orderBy) — which could
    // wrongly reject a legitimate multi-scope organizer depending on which
    // row happened to come back. We now fetch every organizer role row for
    // this member and accept the event if ANY of those scopes makes
    // dto.scope_id reachable. Mirrors the equivalent fix in
    // voting.service.ts::castVote and the DB trigger check_event_creator().
    const organizerRoles = await this.prisma.member_roles.findMany({
      where: { orgid: dto.orgid, uid: dto.uid, is_organizer: true },
      select: { scope_id: true },
      // This ordering is now load-bearing, not just tidiness — the
      // default-scope resolution just below picks organizerRoles[0] as
      // "the organizer's first scope" when the caller doesn't supply one,
      // so this query needs a real, deterministic order rather than
      // whatever Postgres happens to return. scope_id ascending is the
      // best available proxy for "first" here: member_roles carries no
      // created_at of its own to order by, and scope_id is a SERIAL, so
      // the organizer's earliest-assigned scope is (with the rare
      // exception of a scope created and assigned out of order) also
      // their lowest-numbered one. For an organizer who holds ROOT, this
      // also happens to resolve to ROOT, since ROOT is always the first
      // scope row created for an org (create_root_scope() trigger fires
      // the instant the org itself is created).
      orderBy: { scope_id: 'asc' },
    });
    if (organizerRoles.length === 0)
      throw new ForbiddenException('You are not an organizer in this org');

    // Default to the first scope this organizer holds when the caller
    // didn't pick one — mirrors the frontend's "Scope (defaults to org
    // root)" copy, which previously wasn't backed by any actual default:
    // an omitted/null scope_id used to reach the DB as NULL and fail
    // CreateEventDto's (then-required) @IsInt() check. Deliberately the
    // organizer's OWN first scope, not unconditionally the org's ROOT —
    // an organizer who only holds a role at a sub-scope has no organizer
    // role at ROOT, so defaulting everyone to ROOT would make
    // assertScopeReachableForAny() reject their very next line every
    // time they left scope unselected. organizerRoles is already
    // confirmed non-empty by the check just above, so [0] is safe.
    const resolvedScopeId = dto.scope_id ?? organizerRoles[0].scope_id;

    await this.assertScopeInOrg(dto.orgid, resolvedScopeId);
    await this.assertScopeReachableForAny(
      organizerRoles.map((r) => r.scope_id),
      resolvedScopeId,
    );

    const start = new Date(dto.start_time);
    const end = new Date(dto.end_time);
    if (end <= start)
      throw new BadRequestException('end_time must be after start_time');

    // DB trigger trg_populate_event_participants runs after insert
    const event = await this.prisma.events.create({
      data: {
        orgid: dto.orgid,
        created_by_uid: dto.uid,
        scope_id: resolvedScopeId,
        title: dto.title,
        description: dto.description ?? null,
        start_time: start,
        end_time: end,
        show_live_results: dto.show_live_results ?? false,
        visibility_upward: dto.visible_upward ?? false,
        // scope_only is passed through from the DTO
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

    // Validate mutual exclusion. Resolve effective values (dto may only
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
        // scope_only must be passed through on updates too
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

    // Resolve the caller's identity against the EVENT's actual orgid (same
    // pattern as updateEvent/deleteEvent) rather than trusting `user.orgid`,
    // which doesn't exist on a UNIFIED session. Rejecting every non-ORG
    // session type would lock UNIFIED-session organizers out of participant
    // lists for orgs they legitimately organize.
    const orgid = event.orgid ?? '';
    const callerUid = await this.resolveCallerIdentityInOrg(user, orgid);

    // Existence check only — WHICH scopes the caller organizes is resolved in
    // the SQL below, so it no longer matters which single row this returns.
    const role = await this.prisma.member_roles.findFirst({
      where: { orgid, uid: callerUid, is_organizer: true },
    });
    if (!role) throw new ForbiddenException('Not an organizer');

    // Participants are limited to the union of the subtrees of EVERY scope the
    // caller organizes (not one arbitrarily chosen role row). DISTINCT stops a
    // participant who holds several role rows inside those subtrees from
    // being listed once per row.
    const participants = await this.prisma.$queryRaw<any[]>`
      SELECT DISTINCT
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
          SELECT d.scope_id
          FROM member_roles org_r
          CROSS JOIN LATERAL get_scope_descendants(org_r.scope_id) AS d
          WHERE org_r.orgid = ${orgid}
            AND org_r.uid = ${callerUid}
            AND org_r.is_organizer = TRUE
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
   * createEvent, so the same cross-org IDOR fix is applied
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
   * Verifies the caller's resolved org-identity for the EVENT's actual
   * orgid matches the event's created_by_uid — this closes a cross-org
   * IDOR: for ORG sessions this is equivalent to a simple orgid check.
   * For UNIFIED sessions this resolves the caller's uid via
   * pid → org_members (same pattern as RolesGuard/OrgService
   * .resolveCallerUid), rather than trusting a client-supplied uid, which
   * would let any UNIFIED organizer mutate any org's events.
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

  /**
   * Accepts ALL of the organizer's is_organizer = true
   * scope_ids and succeeds if the target scope is a descendant (or self)
   * of ANY one of them — instead of the old single-scope-id version, which
   * only ever saw one arbitrarily chosen role row. Mirrors
   * voting.service.ts::assertScopeEligibilityForAny.
   */
  private async assertScopeReachableForAny(
    organizerScopeIds: number[],
    targetScopeId: number,
  ) {
    for (const organizerScopeId of organizerScopeIds) {
      const rows = await this.prisma.$queryRaw<{ scope_id: number }[]>`
        SELECT scope_id FROM get_scope_descendants(${organizerScopeId}::int)
      `;
      const ids = rows.map((r) => r.scope_id);
      if (ids.includes(targetScopeId)) return;
    }
    throw new ForbiddenException(
      'Cannot create event outside your organizer scope(s)',
    );
  }

  private async assertEventVisible(user: JwtUser, event: any) {
    // Don't pass user.uid straight through: uid is only populated on
    // ORG-session JWTs, and UNIFIED sessions carry a pid instead. With
    // uid=undefined, visibility lookups return zero rows and every UNIFIED
    // user is wrongly told an event (even one they've voted in) isn't
    // visible to them. Resolve the caller's real uid for this event's org
    // first, same pattern as resolveOrgIdentities /
    // resolveCallerIdentityInOrg used elsewhere in this file.
    const uid = await this.resolveViewerUidInOrg(user, event.orgid ?? '');

    // get_visible_events() in the database is
    // get_visible_events(p_orgid VARCHAR, p_scope INT) — it takes a
    // scope_id, not a uid. Calling it with (orgid::text, uid::text) has
    // no matching overload and throws Postgres 42883 / Prisma P2010
    // ("function get_visible_events(text, text) does not exist") on
    // every call, so getResults() was 500ing for everyone. Resolve the
    // caller's scope_id in this org (via member_roles) and pass that.
    if (!uid) {
      throw new ForbiddenException('Event not visible to your account');
    }
    // A member can hold several scopes (PK is orgid, uid, scope_id). The event
    // is visible if it is visible from ANY of them — checking only one
    // arbitrary row could wrongly hide it.
    const roles = await this.prisma.member_roles.findMany({
      where: { orgid: event.orgid ?? '', uid },
      select: { scope_id: true, is_organizer: true },
      orderBy: { scope_id: 'asc' },
    });
    if (roles.length === 0) {
      throw new ForbiddenException('Event not visible to your account');
    }

    for (const { scope_id, is_organizer } of roles) {
      // Organizer branch — mirrors getVisibleEvents: an organizer always
      // sees every event in their scope's subtree (including scope_only
      // ones), because they manage them. get_visible_events() has no such
      // branch, so without this an organizer could see an event in their
      // list but get a 403 opening it (and the creator could not open their
      // own scope_only event in a descendant scope).
      if (is_organizer && event.scope_id != null) {
        const inSubtree = await this.prisma.$queryRaw<{ scope_id: number }[]>`
          SELECT scope_id
          FROM get_scope_descendants(${scope_id}::int)
          WHERE scope_id = ${event.scope_id}::int
        `;
        if (inSubtree.length > 0) return;
      }

      const rows = await this.prisma.$queryRaw<{ event_id: number }[]>`
        SELECT event_id
        FROM get_visible_events(${event.orgid}::varchar, ${scope_id}::int)
        WHERE event_id = ${event.event_id}::int
      `;
      if (rows.length > 0) return;
    }

    throw new ForbiddenException('Event not visible to your account');
  }

  /**
   * Resolves the uid the caller should be evaluated as for visibility
   * checks against a specific org's event.
   * - ORG session    → its own uid, but only if it actually belongs to
   *                     this orgid (an ORG session for a different org
   *                     must not be evaluated under this org's uid).
   * - UNIFIED session → the org_members-linked uid for this orgid, via
   *                     resolveOrgIdentities (handles the pid → uid hop).
   * - SITEADMIN session, or no matching org identity → undefined; the
   *                     caller has no org-scoped uid here, so
   *                     get_visible_events will correctly find nothing
   *                     unless the event is visible independent of org
   *                     membership.
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
   * Resolves every (orgid, uid, scope_id) role row the calling user can act
   * as, with that row's is_organizer flag. A member with several scopes in an
   * org yields one entry per scope, ordered by scope_id so the result is
   * deterministic. Exported so CandidatesService can reuse it without
   * duplication.
   *
   * - ORG session     → all role rows for the JWT's (orgid, uid)
   * - UNIFIED session → all role rows for every org_members link of the pid
   * - SITEADMIN session → no org identities (returns empty)
   */
  async resolveOrgIdentities(user: JwtUser): Promise<
    {
      orgid: string;
      uid: string;
      scope_id: number;
      is_organizer: boolean;
    }[]
  > {
    const toIdentities = (
      roles: {
        orgid: string | null;
        uid: string | null;
        scope_id: number;
        is_organizer: boolean | null;
      }[],
    ) =>
      roles.map((r) => ({
        orgid: r.orgid as string,
        uid: r.uid as string,
        scope_id: r.scope_id,
        is_organizer: r.is_organizer ?? false,
      }));

    if (user.type === 'ORG' && user.orgid && user.uid) {
      const roles = await this.prisma.member_roles.findMany({
        where: { orgid: user.orgid, uid: user.uid },
        orderBy: { scope_id: 'asc' },
      });
      return toIdentities(roles);
    }

    if (user.type === 'UNIFIED' && user.pid) {
      // Pid is string in JWT — BigInt() accepts string, but explicit cast
      //      makes the intent clear and guards against accidental number coercion.
      const links = await this.prisma.org_members.findMany({
        where: { pid: BigInt(user.pid) },
        select: { orgid: true, uid: true },
      });
      if (links.length === 0) return [];

      const roles = await this.prisma.member_roles.findMany({
        where: { OR: links.map(({ orgid, uid }) => ({ orgid, uid })) },
        orderBy: [{ orgid: 'asc' }, { uid: 'asc' }, { scope_id: 'asc' }],
      });
      return toIdentities(roles);
    }

    return [];
  }
}
