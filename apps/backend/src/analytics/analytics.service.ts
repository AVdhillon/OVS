import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ─── Platform analytics ─────────────────────────────────────────────────────
// Orgs-by-status over time, active/completed events, ballots cast — counts
// only, never anything vote-identifying. Read-only aggregation; it writes
// nothing, ever.
//
// **Its own module, alongside src/audit/ rather than inside it.** Both are
// platform-level admin surfaces, but they answer different questions and
// share no code: the audit viewer reads two append-only log tables and its
// whole value is per-row fidelity, while this reads the live domain tables
// and its whole value is that no individual row survives the aggregation.
// Folding analytics into AuditModule would put a service that must never
// expose a row next to one whose job is exposing rows — a distinction worth
// keeping at the module boundary. AuditService is exported from its module
// and deliberately *not* used here: an analytics dashboard built on the
// audit log would be counting admin actions, not platform activity.
//
// ── Privacy: what this service may and may not count ──────────────────────
// "Counts only, never anything vote-identifying" is enforced structurally,
// not by convention:
//
//   * The ballots series selects `count(*)` and `date_trunc(…, voted_at)`
//     and nothing else. It never reads, groups by, or filters on event_id,
//     candidate_id, orgid, voter_hash, ip_address or device_fingerprint,
//     and there is no parameter that could make it do so — the metric
//     takes no dimension argument at all, unlike the three domain metrics
//     below which break down by status.
//   * Ballots are never filterable or groupable by organization or event.
//     A per-event ballot count is turnout, and a per-org one is close
//     enough to it; either belongs to an organizer's own results surface
//     (voting.service.ts / vote_results), not to a platform-wide admin
//     dashboard. There is no orgid parameter on any method here.
//   * vote_results is not read either. That table is keyed by candidate,
//     so aggregating it at all would be reporting outcomes.
//
// The other four metrics count organizations, org requests, events and
// accounts. Those are administrative facts about the platform, not
// anything about how anyone voted.

/** The time buckets a series can be grouped into. Values are passed to
 *  Postgres' date_trunc(), so they are validated against this list before
 *  ever reaching the database — a bad keyword there is a raw PG error, not
 *  something a caller should be able to provoke. */
export const ALL_INTERVALS = ['day', 'week', 'month'] as const;
export type AnalyticsInterval = (typeof ALL_INTERVALS)[number];

/** The series this dashboard can plot. See the privacy note above for why
 *  `ballots` carries no breakdown dimension while the others do. */
export const ALL_METRICS = [
  'organizations',
  'org_requests',
  'events',
  'ballots',
  'accounts',
] as const;
export type AnalyticsMetric = (typeof ALL_METRICS)[number];

/** Metrics that come back broken down by the row's current status. */
const STATUS_METRICS: readonly AnalyticsMetric[] = [
  'organizations',
  'org_requests',
  'events',
];

const DEFAULT_WINDOW_MONTHS = 12;
// A day-bucketed series over a long window is the one shape here that can
// return an unbounded number of points. Capped for the same reason every
// admin list endpoint clamps page_size: admin tooling, but a caller
// still shouldn't be able to ask for one enormous response.
const MAX_BUCKETS = 400;

interface BucketRow {
  bucket: Date;
  status?: string | null;
  n: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Current-state headline counts — the top of the dashboard. Every count
   * here is "how many are there right now", as distinct from getSeries()'s
   * "how many appeared in each period".
   *
   * Soft-deleted rows are excluded from organizations, events and
   * memberships (matching OrgDirectoryService.getCounts()'s own treatment
   * of the same tables, so the dashboard's totals and an org's own detail
   * page can't disagree). org_requests and uaccount have no is_deleted
   * column, so nothing is filtered out of those.
   */
  async getSummary() {
    const [
      orgGroups,
      requestGroups,
      eventGroups,
      ballots,
      accounts,
      memberships,
      admins,
    ] = await Promise.all([
      this.prisma.organization.groupBy({
        by: ['status'],
        where: { is_deleted: false },
        _count: { _all: true },
      }),
      this.prisma.org_requests.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.events.groupBy({
        by: ['status'],
        where: { is_deleted: false },
        _count: { _all: true },
      }),
      // count(), not findMany() — see the privacy note in the header. No
      // ballot row is ever read by this service.
      this.prisma.vote_ballots.count(),
      this.prisma.uaccount.count(),
      this.prisma.org_members.count({ where: { is_deleted: false } }),
      this.prisma.site_admins.count({ where: { is_active: true } }),
    ]);

    const organizations = this.tally(orgGroups, [
      'ACTIVE',
      'SUSPENDED',
      'ARCHIVED',
    ]);
    const orgRequests = this.tally(requestGroups, [
      'PENDING',
      'NEEDS_INFO',
      'APPROVED',
      'REJECTED',
    ]);
    const events = this.tally(eventGroups, [
      'ACTIVE',
      'COMPLETED',
      'CANCELLED',
    ]);

    return {
      organizations,
      org_requests: {
        ...orgRequests,
        // The number an admin opening the queue actually acts on. Derived
        // here rather than left to the client so it can't drift from
        // OrgRequestsService.list()'s own definition of "open".
        open: orgRequests.by_status.PENDING + orgRequests.by_status.NEEDS_INFO,
      },
      events,
      ballots_cast: ballots,
      accounts,
      org_memberships: memberships,
      active_site_admins: admins,
    };
  }

  /**
   * One time-bucketed series. `organizations` / `org_requests` / `events`
   * come back broken down by status; `ballots` and `accounts` are a bare
   * count per bucket.
   *
   * **What "orgs-by-status over time" means here, precisely:** rows are
   * bucketed by when they were *created* and labelled with their *current*
   * status. It is not a historical snapshot of what each org's status was
   * during that period — `organization` stores only current state, so an
   * org suspended last week appears as SUSPENDED in the month it was
   * registered. A true status-as-of-then series is reconstructible, but
   * only by replaying `audit_logs` row diffs (the territory), which is a
   * far heavier query than a dashboard should run per page load. Called out
   * here and surfaced in the page's own copy rather than left for someone
   * to misread the chart.
   *
   * Buckets are generated by Postgres, not JS, and zero-filled: the bucket
   * spine comes from generate_series() over the same date_trunc() the
   * aggregate uses, so week boundaries (ISO, Monday-start) and month
   * boundaries can't disagree between the two — computing them in JS would
   * be reimplementing date_trunc and getting weeks subtly wrong.
   */
  async getSeries(
    options: {
      metric?: string;
      interval?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    const metric = this.resolveMetric(options.metric);
    const interval = this.resolveInterval(options.interval);
    const { from, to } = this.resolveRange(options.from, options.to);

    const buckets = await this.prisma.$queryRaw<Array<{ bucket: Date }>>`
      SELECT generate_series(
               date_trunc(${interval}, ${from}::timestamp),
               date_trunc(${interval}, ${to}::timestamp),
               ('1 ' || ${interval})::interval
             ) AS bucket
    `;

    if (buckets.length > MAX_BUCKETS) {
      throw new BadRequestException(
        `That range produces ${buckets.length} ${interval} buckets (max ${MAX_BUCKETS}). Narrow the range or use a coarser interval.`,
      );
    }

    const rows = await this.aggregate(metric, interval, from, to);
    const statuses = STATUS_METRICS.includes(metric)
      ? this.statusesFor(metric)
      : null;

    // Merged on the bucket's epoch value rather than a formatted string —
    // both sides come from the same date_trunc(), so the Date instances are
    // equal to the millisecond and there's no formatting round trip to get
    // wrong.
    const byBucket = new Map<number, BucketRow[]>();
    for (const row of rows) {
      const key = row.bucket.getTime();
      const list = byBucket.get(key);
      if (list) list.push(row);
      else byBucket.set(key, [row]);
    }

    const points = buckets.map(({ bucket }) => {
      const hits = byBucket.get(bucket.getTime()) ?? [];
      const total = hits.reduce((sum, r) => sum + Number(r.n), 0);
      if (!statuses) return { bucket, total };
      const byStatus: Record<string, number> = {};
      for (const s of statuses) byStatus[s] = 0;
      for (const hit of hits) {
        if (hit.status && hit.status in byStatus) {
          byStatus[hit.status] = Number(hit.n);
        }
      }
      return { bucket, total, by_status: byStatus };
    });

    return {
      metric,
      interval,
      from,
      to,
      statuses,
      points,
      total: points.reduce((sum, p) => sum + p.total, 0),
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * One fixed SQL template per metric rather than one template with an
   * interpolated table name. The table and its date column are not values,
   * so they cannot be bound as parameters, and building the string would
   * be the first dynamic-SQL-fragment construction in this codebase — the
   * same reasoning OrgDirectoryService gives for not writing its counts as
   * one raw aggregate. Verbose, but every string here is a literal.
   */
  private aggregate(
    metric: AnalyticsMetric,
    interval: AnalyticsInterval,
    from: Date,
    to: Date,
  ): Promise<BucketRow[]> {
    switch (metric) {
      case 'organizations':
        return this.prisma.$queryRaw<BucketRow[]>`
          SELECT date_trunc(${interval}, created_at) AS bucket,
                 status,
                 count(*)::int AS n
          FROM organization
          WHERE is_deleted = FALSE
            AND created_at >= ${from} AND created_at <= ${to}
          GROUP BY 1, 2
        `;
      case 'org_requests':
        return this.prisma.$queryRaw<BucketRow[]>`
          SELECT date_trunc(${interval}, created_at) AS bucket,
                 status,
                 count(*)::int AS n
          FROM org_requests
          WHERE created_at >= ${from} AND created_at <= ${to}
          GROUP BY 1, 2
        `;
      case 'events':
        return this.prisma.$queryRaw<BucketRow[]>`
          SELECT date_trunc(${interval}, created_at) AS bucket,
                 status,
                 count(*)::int AS n
          FROM events
          WHERE is_deleted = FALSE
            AND created_at >= ${from} AND created_at <= ${to}
          GROUP BY 1, 2
        `;
      case 'ballots':
        // Two columns, both aggregates of time. No dimension parameter
        // exists on this branch and none should be added — see the header.
        return this.prisma.$queryRaw<BucketRow[]>`
          SELECT date_trunc(${interval}, voted_at) AS bucket,
                 count(*)::int AS n
          FROM vote_ballots
          WHERE voted_at >= ${from} AND voted_at <= ${to}
          GROUP BY 1
        `;
      case 'accounts':
        return this.prisma.$queryRaw<BucketRow[]>`
          SELECT date_trunc(${interval}, created_at) AS bucket,
                 count(*)::int AS n
          FROM uaccount
          WHERE created_at >= ${from} AND created_at <= ${to}
          GROUP BY 1
        `;
    }
  }

  /** The CHECK-constrained status set each breakdown metric reports over,
   *  so a bucket with no rows still renders every series at zero rather
   *  than the chart's legend changing shape as data arrives. */
  private statusesFor(metric: AnalyticsMetric): string[] {
    switch (metric) {
      case 'organizations':
        return ['ACTIVE', 'SUSPENDED', 'ARCHIVED'];
      case 'org_requests':
        return ['PENDING', 'NEEDS_INFO', 'APPROVED', 'REJECTED'];
      case 'events':
        return ['ACTIVE', 'COMPLETED', 'CANCELLED'];
      default:
        return [];
    }
  }

  private tally(
    groups: Array<{ status: string | null; _count: { _all: number } }>,
    known: string[],
  ) {
    const by_status: Record<string, number> = {};
    for (const s of known) by_status[s] = 0;
    let total = 0;
    for (const g of groups) {
      const count = g._count._all;
      total += count;
      // `events.status` is nullable with a DEFAULT rather than NOT NULL, so
      // a row could in principle carry NULL. Counted into the total but not
      // attributed to a status, rather than silently dropped.
      if (g.status && g.status in by_status) by_status[g.status] = count;
    }
    return { total, by_status };
  }

  private resolveMetric(metric?: string): AnalyticsMetric {
    if (!metric) return 'organizations';
    const normalized = metric.trim().toLowerCase();
    if (!(ALL_METRICS as readonly string[]).includes(normalized)) {
      throw new BadRequestException(
        `Invalid metric "${metric}". Expected one of: ${ALL_METRICS.join(', ')}.`,
      );
    }
    return normalized as AnalyticsMetric;
  }

  private resolveInterval(interval?: string): AnalyticsInterval {
    if (!interval) return 'month';
    const normalized = interval.trim().toLowerCase();
    if (!(ALL_INTERVALS as readonly string[]).includes(normalized)) {
      throw new BadRequestException(
        `Invalid interval "${interval}". Expected one of: ${ALL_INTERVALS.join(', ')}.`,
      );
    }
    return normalized as AnalyticsInterval;
  }

  /**
   * Defaults to the last DEFAULT_WINDOW_MONTHS. A bounded default is not
   * cosmetic: it is what keeps the ballots series a bitmap index scan over
   * idx_vote_ballots_voted_at instead of a full
   * scan of the largest table in the system.
   */
  private resolveRange(from?: string, to?: string) {
    const parsedTo = this.parseDate(to, 'to') ?? new Date();
    let parsedFrom = this.parseDate(from, 'from');
    if (!parsedFrom) {
      parsedFrom = new Date(parsedTo);
      parsedFrom.setMonth(parsedFrom.getMonth() - DEFAULT_WINDOW_MONTHS);
    }
    if (parsedFrom > parsedTo) {
      throw new BadRequestException('`from` must not be later than `to`.');
    }
    return { from: parsedFrom, to: parsedTo };
  }

  private parseDate(value: string | undefined, label: string): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `Invalid \`${label}\` date. Expected an ISO-8601 timestamp.`,
      );
    }
    return parsed;
  }
}
