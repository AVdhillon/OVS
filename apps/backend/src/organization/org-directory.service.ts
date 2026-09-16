import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ─── Org directory (Phase 3 — admin portal core, subphase 3.3) ────────────
// EDIT: new service. The read-only counterpart to OrgLifecycleService
// (3.2) — where that service changes `organization.status`, this one
// answers "what does the current landscape of organizations look like,"
// for the admin app's org-directory page (list()) and org-detail page
// (getDetail(), 3.6's suspend/reinstate screen).
//
// Deliberately its own service rather than added to OrgService: OrgService
// is scoped to org-member/organizer callers (assertOrganizerAccess() gates
// almost everything in it) — nothing in this file needs, or should be
// reachable with, an org-member's uid the way OrgService's methods are.
// Same domain-separation reasoning 2.3's own module comment gives for
// OrgRequestsService vs. OrgService. Mirrors OrgRequestsService's own
// list()/getDetail() shape (3.1) one-for-one: same pagination clamp, same
// batched-$transaction count+findMany, same "attach the read-only extras a
// detail page needs, as separate queries rather than an `include`" choice.
//
// `member_count`/`scope_count`/event-status breakdown are computed with
// plain `.count()`/`.groupBy()` calls per organization (Promise.all, not a
// single joined aggregate query) rather than one big raw-SQL query with
// dynamic WHERE fragments — deliberately: there is no precedent anywhere in
// this codebase for building a `$queryRaw` query with caller-supplied
// dynamic filter fragments (every existing `$queryRaw` call in this
// codebase, including OrgLifecycleService's own locking reads, is a fixed
// template with only its interpolated *values* varying), and introducing
// one here would be a new pattern for a directory endpoint whose page size
// is capped at 100 anyway (see list()) — the same capped-page-size
// reasoning list() below already gives for not needing to worry about an
// unbounded per-page query count. If this ever needs to scale past that,
// the natural next step is a materialized/rolled-up counts table, not a
// bigger raw query.

/** Mirrors organization.chk_org_status in the master schema. */
export type OrgStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export const ALL_ORG_STATUSES: readonly OrgStatus[] = [
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
];

interface OrgCounts {
  member_count: number;
  scope_count: number;
  events: {
    active: number;
    completed: number;
    cancelled: number;
    total: number;
  };
}

@Injectable()
export class OrgDirectoryService {
  constructor(private prisma: PrismaService) {}

  /**
   * The admin org-directory (3.6's directory page). Unlike
   * OrgRequestsService.list() — which defaults to *open* requests because
   * that's the review queue's whole point — this defaults to every
   * non-deleted organization regardless of status: a directory is a
   * landscape view, not a to-do list, and an admin should see ARCHIVED
   * orgs here by default (filterable back out via `?status=` if they
   * don't want them), not have them silently hidden.
   */
  async list(
    options: {
      status?: string[];
      search?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const statuses = this.resolveStatusFilter(options.status);
    const page =
      options.page && options.page > 0 ? Math.floor(options.page) : 1;
    // Same cap/reasoning as OrgRequestsService.list(): admin tooling, not a
    // public export endpoint, but still capped so a caller can't force one
    // very expensive page.
    const pageSize =
      options.pageSize && options.pageSize > 0
        ? Math.min(Math.floor(options.pageSize), 100)
        : 25;

    const search = options.search?.trim();

    const where = {
      is_deleted: false,
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(search
        ? {
            OR: [
              { org_name: { contains: search, mode: 'insensitive' as const } },
              { orgid: { contains: search.toUpperCase() } },
            ],
          }
        : {}),
    };

    const [total, orgs] = await this.prisma.$transaction([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          orgid: true,
          org_name: true,
          org_email: true,
          status: true,
          created_at: true,
        },
      }),
    ]);

    const organizations = await Promise.all(
      orgs.map(async (org) => ({
        ...org,
        ...(await this.getCounts(org.orgid)),
      })),
    );

    return { organizations, total, page, page_size: pageSize };
  }

  /**
   * Org detail (3.6's suspend/reinstate screen): the org row, its counts,
   * and the full admin_audit_log trail for it — every past
   * suspend/reinstate/archive on this org, same "whole history, not just
   * current state" reasoning as OrgRequestsService.getDetail()'s own
   * audit_trail. Fetched as a separate query rather than folded into an
   * `include`, for the same real-relation-field-names-aren't-knowable-yet
   * reason getDetail() there gives (the `prisma db pull` regen is still
   * outstanding).
   */
  async getDetail(orgid: string) {
    const org = await this.prisma.organization.findUnique({
      where: { orgid },
    });
    if (!org || org.is_deleted) {
      throw new NotFoundException(`Organization ${orgid} not found`);
    }

    const [counts, auditTrail] = await Promise.all([
      this.getCounts(orgid),
      this.prisma.admin_audit_log.findMany({
        where: { target_type: 'ORGANIZATION', target_id: orgid },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    return { ...org, ...counts, audit_trail: auditTrail };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * member_count: active (`is_deleted = FALSE`) org_members rows.
   * scope_count: every org_scope row for the org, ROOT included — org_scope
   * has no is_deleted column to filter on (deleting a non-empty scope is
   * blocked at the DB level by trg_prevent_nonempty_scope_delete, so every
   * row here is a real, currently-standing scope).
   * events: a status breakdown (ACTIVE/COMPLETED/CANCELLED, `is_deleted =
   * FALSE`) via groupBy, not just a total — "event activity" in the plan's
   * own phrasing for this subphase reads as more than one bare count, and
   * an admin deciding whether to suspend/archive an org cares whether its
   * events are still active vs. already wound down.
   */
  private async getCounts(orgid: string): Promise<OrgCounts> {
    const [memberCount, scopeCount, eventGroups] = await Promise.all([
      this.prisma.org_members.count({ where: { orgid, is_deleted: false } }),
      this.prisma.org_scope.count({ where: { orgid } }),
      this.prisma.events.groupBy({
        by: ['status'],
        where: { orgid, is_deleted: false },
        _count: { _all: true },
      }),
    ]);

    const events = { active: 0, completed: 0, cancelled: 0, total: 0 };
    for (const row of eventGroups as Array<{
      status: string;
      _count: { _all: number };
    }>) {
      const count = row._count._all;
      switch (row.status) {
        case 'ACTIVE':
          events.active = count;
          break;
        case 'COMPLETED':
          events.completed = count;
          break;
        case 'CANCELLED':
          events.cancelled = count;
          break;
      }
      events.total += count;
    }

    return { member_count: memberCount, scope_count: scopeCount, events };
  }

  /**
   * Same shape as OrgRequestsService's own status-filter validator, over
   * the organization status set instead of the org_requests one. Returns
   * `undefined` (no filter — every status) when nothing was supplied,
   * unlike that method's "default to the open subset" — see list()'s own
   * comment for why a directory's default differs from a review queue's.
   */
  private resolveStatusFilter(status?: string[]): OrgStatus[] | undefined {
    if (!status || status.length === 0) return undefined;
    const normalized = status.map((s) => s.trim().toUpperCase());
    for (const s of normalized) {
      if (!(ALL_ORG_STATUSES as readonly string[]).includes(s)) {
        throw new BadRequestException(
          `Invalid status "${s}". Expected one of: ${ALL_ORG_STATUSES.join(', ')}.`,
        );
      }
    }
    return normalized as OrgStatus[];
  }
}
