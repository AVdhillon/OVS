import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ─── Audit viewer (Phase 5 — platform maturity, subphase 5.1) ──────────────
// EDIT: new service. The plan's own description of this subphase is
// "surface admin_audit_log (intent) with drill-down into audit_logs (row
// diffs) for a given org", and the master schema's admin_audit_log header
// comment states the same pairing from the other side: admin_audit_log
// answers "SA0001 suspended ABC1234 on Tuesday for reason X", audit_logs
// answers "here is every column that moved as a result". This service is
// the read side of exactly that pairing — it writes nothing, ever.
//
// **New module, not added to OrgModule.** Every prior admin surface (3.1's
// org-request queue, 3.3's org directory) lives in the organization module
// because its subject is an organization. This one's subject is the
// platform's own audit record: admin_audit_log spans ORG_REQUEST,
// ORGANIZATION and SITE_ADMIN targets (the last of which 5.3 will start
// writing), and audit_logs spans events/org_members/member_roles/
// organization/org_requests/vote_ballots. Putting it in OrgModule would
// mean 5.3's admin-account actions get audited by a service that lives in
// the org domain. It is deliberately a leaf: PrismaModule only, no other
// domain service injected.
//
// ── Two findings from reading the schema, both load-bearing here ──────────
//
// 1. **audit_logs.record_id is not a key.** audit_trigger_function() sets
//    it to `NEW::TEXT` — the *entire row* rendered as a Postgres tuple
//    literal (e.g. `(ABC1234,"Alpha Club",a@alpha.org,ACTIVE,t,f,...)`),
//    not the row's primary key. So there is no way to look a row's history
//    up by record_id. The usable key lives inside `changed_data`, which is
//    `to_jsonb(NEW)` — hence the `changed_data->>'orgid'` predicate in
//    listOrgChanges() below, and the matching expression index 5.1 added to
//    the master schema. Verified against a live Postgres instance, not
//    inferred from the trigger source alone.
//
// 2. **Transaction timestamp is the correlation key.** Postgres'
//    CURRENT_TIMESTAMP is transaction-*start* time, and 2.4/2.5/3.2 all
//    write their admin_audit_log line inside the same transaction as the
//    change it describes (the schema comment calls that out explicitly:
//    "never best-effort, never after the fact"). Both columns default to
//    CURRENT_TIMESTAMP, so for a given admin action the two tables carry a
//    byte-identical timestamp. That equality is what
//    getAdminActionDetail() joins on. Also verified live: an approve()
//    transaction's admin_audit_log row and all four of its audit_logs rows
//    came back at the identical microsecond, while an unrelated INSERT from
//    a different transaction milliseconds earlier did not match.
//
//    The join is done **entirely in SQL, never by reading created_at into
//    JS and passing it back down as a parameter** — audit_logs.changed_at
//    and admin_audit_log.created_at are TIMESTAMP (microsecond precision),
//    but a JS `Date` only carries milliseconds, so a round trip through
//    Prisma's DateTime mapping would truncate .657628 to .657 and match
//    nothing at all. This is the single easiest way to get this method
//    silently wrong.
//
// ── Privacy ───────────────────────────────────────────────────────────────
// audit_logs has a trigger on `vote_ballots`. Those rows carry voter_hash,
// ip_address and device_fingerprint, and surfacing them in an admin-facing
// row-diff viewer would undo the anonymity the schema's own finding-#1 fix
// was written to establish. Two independent guards, not one:
//   * getAdminActionDetail() excludes table_name = 'vote_ballots' outright.
//   * listOrgChanges() cannot reach them structurally — vote_ballots has no
//     orgid column, so no vote_ballots row's changed_data carries the
//     `orgid` key the query filters on (confirmed live: zero such rows).
// On top of both, redactChangedData() strips a small key denylist from
// every payload this service returns, so a future audit trigger on a table
// holding one of those keys can't leak it through a code path nobody
// revisited. What is deliberately *not* redacted: org_members contact
// fields. An admin already sees requester contact details on 3.1's
// request-detail page, so this isn't a new exposure class, and redacting
// them would gut the viewer's usefulness — flagged here as a decision, not
// an oversight, in case a later privacy pass wants to revisit it.

/** Mirrors admin_audit_log's chk_admin_audit_action in the master schema. */
export const ALL_ADMIN_ACTIONS = [
  'ORG_REQUEST_APPROVED',
  'ORG_REQUEST_REJECTED',
  'ORG_REQUEST_INFO_REQUESTED',
  'ORG_SUSPENDED',
  'ORG_REINSTATED',
  'ORG_ARCHIVED',
  'ADMIN_INVITED',
  'ADMIN_DEACTIVATED',
] as const;
export type AdminAction = (typeof ALL_ADMIN_ACTIONS)[number];

/** Mirrors admin_audit_log's chk_admin_audit_target_type. */
export const ALL_TARGET_TYPES = [
  'ORG_REQUEST',
  'ORGANIZATION',
  'SITE_ADMIN',
] as const;
export type AdminTargetType = (typeof ALL_TARGET_TYPES)[number];

/**
 * The audit_logs tables that carry an `orgid` column, and are therefore
 * reachable by listOrgChanges(). Exported so the admin app can render a
 * table filter without hardcoding its own copy of the list. Note this is
 * documentation of a DB fact, not an enforcement mechanism — the query's
 * own `changed_data->>'orgid'` predicate is what actually scopes it (see
 * the header note on vote_ballots).
 */
export const ORG_AUDITED_TABLES = [
  'organization',
  'org_members',
  'member_roles',
  'events',
] as const;

/** Keys never returned in a changed_data payload. See the header note. */
const REDACTED_KEYS = new Set([
  'voter_hash',
  'ip_address',
  'device_fingerprint',
  'otp_code',
  'password',
  'token',
]);

const REDACTED_PLACEHOLDER = '[redacted]';

export interface AuditRowDiff {
  log_id: number;
  table_name: string;
  operation: string;
  changed_at: Date;
  changed_by: string | null;
  changed_data: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * The intent-level feed: admin_audit_log, newest first, filterable.
   *
   * Unlike OrgRequestsService.list() (a review queue, so it defaults to
   * open requests) and OrgDirectoryService.list() (a directory, so it
   * defaults to every status), an audit log has no meaningful default
   * subset — the whole point is that nothing is hidden — so an unfiltered
   * call returns the complete reverse-chronological record. Every filter
   * below is additive and optional.
   *
   * Ordering and each filter shape match an index the schema already
   * carries: idx_admin_audit_created (unfiltered feed),
   * idx_admin_audit_admin (admin_id + created_at DESC — "what has this
   * admin been doing", which is also what 5.3 will want), and
   * idx_admin_audit_target (target_type + target_id + created_at DESC —
   * the per-org and per-request history).
   */
  async listAdminActions(
    options: {
      adminId?: string;
      action?: string[];
      targetType?: string;
      targetId?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const actions = this.resolveActionFilter(options.action);
    const targetType = this.resolveTargetTypeFilter(options.targetType);
    const from = this.parseDate(options.from, 'from');
    const to = this.parseDate(options.to, 'to');

    if (from && to && from > to) {
      throw new BadRequestException('`from` must not be later than `to`.');
    }

    const page =
      options.page && options.page > 0 ? Math.floor(options.page) : 1;
    // Same clamp and reasoning as OrgRequestsService.list() /
    // OrgDirectoryService.list(): admin tooling, not a bulk export, but
    // still capped so a caller can't force one very expensive page.
    const pageSize =
      options.pageSize && options.pageSize > 0
        ? Math.min(Math.floor(options.pageSize), 100)
        : 25;

    const where = {
      ...(options.adminId ? { admin_id: options.adminId.trim() } : {}),
      ...(actions ? { action: { in: actions } } : {}),
      ...(targetType ? { target_type: targetType } : {}),
      ...(options.targetId ? { target_id: options.targetId.trim() } : {}),
      ...(from || to
        ? {
            created_at: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    // Batched into one $transaction so `total` and the page it describes
    // are read consistently — same shape 3.1/3.3 use for their own lists.
    const [total, entries] = await this.prisma.$transaction([
      this.prisma.admin_audit_log.count({ where }),
      this.prisma.admin_audit_log.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { entries, total, page, page_size: pageSize };
  }

  /**
   * One admin_audit_log entry plus the row diffs written in the same
   * transaction — the drill-down half of the plan's "intent, with
   * drill-down into row diffs" pairing.
   *
   * The actor is attached as a separate site_admins query rather than a
   * Prisma `include`. The relation exists in schema.prisma
   * (admin_audit_log.site_admins), but this codebase has fetched these
   * separately since 3.1 for consistency with the methods written while
   * that regen was still outstanding; there's no behavioural difference at
   * one row.
   *
   * Scoped to the transaction, not to the target, and that is deliberate:
   * approving a request writes an ORG_REQUEST-targeted log line while the
   * rows that actually moved are in `organization`, `org_members` and
   * `member_roles` — filtering the diffs by the entry's own target would
   * hide precisely the changes an auditor opened this page to see.
   */
  async getAdminActionDetail(adminLogId: bigint) {
    const entry = await this.prisma.admin_audit_log.findUnique({
      where: { admin_log_id: adminLogId },
    });
    if (!entry) {
      throw new NotFoundException(`Audit entry ${adminLogId} not found`);
    }

    const [admin, rawChanges] = await Promise.all([
      this.prisma.site_admins.findUnique({
        where: { admin_id: entry.admin_id },
        select: { admin_id: true, name: true, is_active: true },
      }),
      // See the header note: the timestamp equality is evaluated in SQL so
      // the microsecond value never round-trips through a JS Date.
      this.prisma.$queryRaw<AuditRowDiff[]>`
        SELECT l.log_id,
               l.table_name,
               l.operation,
               l.changed_at,
               l.changed_by,
               l.changed_data
        FROM audit_logs l
        JOIN admin_audit_log a ON l.changed_at = a.created_at
        WHERE a.admin_log_id = ${adminLogId}
          AND l.table_name <> 'vote_ballots'
        ORDER BY l.log_id
      `,
    ]);

    return {
      ...entry,
      admin,
      changes: rawChanges.map((row) => this.redactRow(row)),
    };
  }

  /**
   * Every audited row change for one organization — the "for a given org"
   * drill-down the plan names, and the view an admin lands on from 3.6's
   * org-detail page.
   *
   * Keyed on `changed_data->>'orgid'` rather than on record_id (see the
   * header note on why record_id is unusable), which covers all four
   * org-scoped audited tables with one predicate and one expression index.
   *
   * `is_deleted` orgs are **not** hidden here, unlike
   * OrgDirectoryService.getDetail()'s own 404-on-deleted behaviour: a
   * directory legitimately hides retired rows, but an audit trail whose
   * contents disappear when the subject is removed is not an audit trail.
   * Only a genuinely non-existent orgid 404s.
   */
  async listOrgChanges(
    orgid: string,
    options: { table?: string; page?: number; pageSize?: number } = {},
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { orgid },
      select: { orgid: true, org_name: true, status: true, is_deleted: true },
    });
    if (!org) {
      throw new NotFoundException(`Organization ${orgid} not found`);
    }

    const table = this.resolveTableFilter(options.table);
    const page =
      options.page && options.page > 0 ? Math.floor(options.page) : 1;
    const pageSize =
      options.pageSize && options.pageSize > 0
        ? Math.min(Math.floor(options.pageSize), 100)
        : 25;
    const offset = (page - 1) * pageSize;

    // `table` is bound as a nullable parameter and the predicate is written
    // to no-op when it's NULL, rather than assembling a different SQL
    // string per filter combination — this keeps one fixed template with
    // only its values varying, which is the only $queryRaw shape with
    // precedent in this codebase (see org-requests.service.ts).
    const [changes, countRows] = await Promise.all([
      this.prisma.$queryRaw<AuditRowDiff[]>`
        SELECT log_id, table_name, operation, changed_at, changed_by,
               changed_data
        FROM audit_logs
        WHERE changed_data->>'orgid' = ${orgid}
          AND (${table}::text IS NULL OR table_name = ${table})
        ORDER BY changed_at DESC, log_id DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<Array<{ total: bigint | string | number }>>`
        SELECT count(*) AS total
        FROM audit_logs
        WHERE changed_data->>'orgid' = ${orgid}
          AND (${table}::text IS NULL OR table_name = ${table})
      `,
    ]);

    return {
      organization: org,
      changes: changes.map((row) => this.redactRow(row)),
      // count(*) is BIGINT. Through a raw query it arrives as a string
      // (node-postgres does not parse int8 into a lossy JS number) — the
      // union type above reflects what the driver actually hands back,
      // verified rather than assumed. Number() here rather than leaving it
      // for BigIntInterceptor, so `total` is a number on the wire like
      // every other paginated admin response (3.1/3.3 get theirs from
      // Prisma .count(), which already returns a number).
      total: Number(countRows[0]?.total ?? 0),
      page,
      page_size: pageSize,
      // So a client can build its table filter from the server's own list
      // rather than maintaining a second copy of it.
      available_tables: ORG_AUDITED_TABLES,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private redactRow(row: AuditRowDiff): AuditRowDiff {
    return { ...row, changed_data: this.redactChangedData(row.changed_data) };
  }

  /**
   * Strips REDACTED_KEYS from a changed_data payload. Replaces rather than
   * deletes when the key was actually present and non-null, so the viewer
   * still shows *that* the column moved without showing what to — silently
   * dropping the key would misrepresent the diff.
   */
  private redactChangedData(
    data: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!data || typeof data !== 'object') return data;
    let touched = false;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (REDACTED_KEYS.has(key)) {
        touched = true;
        out[key] = value === null ? null : REDACTED_PLACEHOLDER;
      } else {
        out[key] = value;
      }
    }
    return touched ? out : data;
  }

  /**
   * Same validate-against-the-known-set shape OrgRequestsService.list() and
   * OrgDirectoryService.list() use for their own status filters: an
   * unrecognised value is a 400, not a silent zero-row result.
   */
  private resolveActionFilter(action?: string[]): AdminAction[] | undefined {
    if (!action || action.length === 0) return undefined;
    const normalized = action.map((a) => a.trim().toUpperCase());
    for (const a of normalized) {
      if (!(ALL_ADMIN_ACTIONS as readonly string[]).includes(a)) {
        throw new BadRequestException(
          `Invalid action "${a}". Expected one of: ${ALL_ADMIN_ACTIONS.join(', ')}.`,
        );
      }
    }
    return normalized as AdminAction[];
  }

  private resolveTargetTypeFilter(
    targetType?: string,
  ): AdminTargetType | undefined {
    if (!targetType) return undefined;
    const normalized = targetType.trim().toUpperCase();
    if (!(ALL_TARGET_TYPES as readonly string[]).includes(normalized)) {
      throw new BadRequestException(
        `Invalid target_type "${targetType}". Expected one of: ${ALL_TARGET_TYPES.join(', ')}.`,
      );
    }
    return normalized as AdminTargetType;
  }

  private resolveTableFilter(table?: string): string | null {
    if (!table) return null;
    const normalized = table.trim().toLowerCase();
    if (!(ORG_AUDITED_TABLES as readonly string[]).includes(normalized)) {
      throw new BadRequestException(
        `Invalid table "${table}". Expected one of: ${ORG_AUDITED_TABLES.join(', ')}.`,
      );
    }
    return normalized;
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
