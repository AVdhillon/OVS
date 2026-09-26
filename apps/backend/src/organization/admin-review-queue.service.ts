import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALL_ORG_REQUEST_STATUSES,
  OPEN_ORG_REQUEST_STATUSES,
} from './org-requests.service';
// EDIT (Phase 7 — subphase 7.2/7.3 cleanup): OrgLimitRequestsService now
// exists and exports this same list — imported from there instead of the
// local duplicate this file carried since 7.1b (see that duplicate's own
// now-resolved comment, below where it used to sit).
import { ALL_LIMIT_REQUEST_STATUSES } from './org-limit-requests.service';

// ─── Unified admin review queue (Phase 7 — Member Limit Increase Requests,
// subphase 7.1b) ─────────────────────────────────────────────────────────────
// EDIT (subphase 7.1b): new service. Backs `GET /admin/review-queue` — see
// post-approval-org-setup-plan.md's 7.1b section and dbschema.sql's own
// `admin_review_queue` view comment (7e) for the full reasoning: org_requests
// and org_member_limit_requests stay separate tables, this is just a
// read-only union of the two for the admin queue UI.
//
// Deliberately a service of its own rather than a new method on
// OrgRequestsService: this queue isn't really "about" org_requests any more
// than it's "about" org_member_limit_requests — it's about neither table
// specifically, just the view over both — so bolting it onto either table's
// own service would misplace it the same way merging the tables themselves
// would have (per the plan's own reasoning against that). 7.2's
// OrgLimitRequestsService, once it exists, is not a dependency here: nothing
// below needs to write to either table, only read the view.
//
// $queryRaw rather than a Prisma model for `admin_review_queue`: Prisma views
// support requires the `views` preview feature, which isn't enabled in
// schema.prisma today (only `partialIndexes` is — see that file's own
// generator block) and turning it on can't be verified against
// `prisma generate`/`prisma validate` in this sandbox (the standing
// `binaries.prisma.sh` egress gap PROGRESS.md already documents for every
// other Prisma-touching subphase). Same reasoning findClosestOrgNameMatch()
// (org-requests.service.ts) already uses for pg_trgm's similarity() — reach
// for raw SQL when there's no Prisma-level equivalent, rather than change
// generator config this session can't confirm still builds.

export type AdminReviewQueueRequestType = 'ORG_CREATION' | 'MEMBER_LIMIT_INCREASE';

export const ALL_REVIEW_QUEUE_REQUEST_TYPES: readonly AdminReviewQueueRequestType[] =
  ['ORG_CREATION', 'MEMBER_LIMIT_INCREASE'];

interface AdminReviewQueueRow {
  id: string;
  request_type: AdminReviewQueueRequestType;
  status: string;
  created_at: Date;
  reviewed_by_admin_id: string | null;
  reviewed_at: Date | null;
}

@Injectable()
export class AdminReviewQueueService {
  constructor(private prisma: PrismaService) {}

  /**
   * The unified queue (7.1b/7.4's queue-with-badges view). Same
   * default/filter/paging shape as OrgRequestsService.list() — open requests
   * only by default (an admin opening the queue wants work to do, not a full
   * history), ordered oldest-first within a status, capped page size — so
   * the two list endpoints behave identically from the frontend's point of
   * view, differing only in which rows they return.
   *
   * `status` is validated against the union of both tables' status enums
   * (not just one), since a single filter value here can legitimately mean
   * either table's row — e.g. "REJECTED" is valid for both,
   * "APPROVED_PENDING_SETUP" only exists on the org_requests side.
   */
  async list(
    options: {
      status?: string[];
      requestType?: string[];
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const statuses = this.resolveStatusFilter(options.status);
    const requestTypes = this.resolveRequestTypeFilter(options.requestType);
    const page =
      options.page && options.page > 0 ? Math.floor(options.page) : 1;
    // Same 100 cap as OrgRequestsService.list() — an admin queue, not a
    // public export endpoint.
    const pageSize =
      options.pageSize && options.pageSize > 0
        ? Math.min(Math.floor(options.pageSize), 100)
        : 25;
    const offset = (page - 1) * pageSize;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<AdminReviewQueueRow[]>`
        SELECT id, request_type, status, created_at, reviewed_by_admin_id, reviewed_at
        FROM admin_review_queue
        WHERE status = ANY(${statuses}) AND request_type = ANY(${requestTypes})
        ORDER BY status ASC, created_at ASC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM admin_review_queue
        WHERE status = ANY(${statuses}) AND request_type = ANY(${requestTypes})
      `,
    ]);

    return {
      requests: rows,
      // Postgres COUNT(*) comes back as a bigint — Prisma's $queryRaw
      // doesn't coerce it the way findMany()'s count() does, so it's cast
      // explicitly here rather than left as a bigint the JSON response
      // layer would otherwise choke on.
      total: Number(countRows[0]?.count ?? 0),
      page,
      page_size: pageSize,
    };
  }

  private resolveStatusFilter(status?: string[]): string[] {
    if (!status || status.length === 0) {
      return [...OPEN_ORG_REQUEST_STATUSES];
    }
    const normalized = status.map((s) => s.trim().toUpperCase());
    const allValid = new Set<string>([
      ...ALL_ORG_REQUEST_STATUSES,
      ...ALL_LIMIT_REQUEST_STATUSES,
    ]);
    for (const s of normalized) {
      if (!allValid.has(s)) {
        throw new BadRequestException(
          `Invalid status "${s}". Expected one of: ${[...allValid].join(', ')}.`,
        );
      }
    }
    return normalized;
  }

  private resolveRequestTypeFilter(
    requestType?: string[],
  ): AdminReviewQueueRequestType[] {
    if (!requestType || requestType.length === 0) {
      return [...ALL_REVIEW_QUEUE_REQUEST_TYPES];
    }
    const normalized = requestType.map((t) => t.trim().toUpperCase());
    for (const t of normalized) {
      if (
        !(ALL_REVIEW_QUEUE_REQUEST_TYPES as readonly string[]).includes(t)
      ) {
        throw new BadRequestException(
          `Invalid request_type "${t}". Expected one of: ${ALL_REVIEW_QUEUE_REQUEST_TYPES.join(', ')}.`,
        );
      }
    }
    return normalized as AdminReviewQueueRequestType[];
  }
}
