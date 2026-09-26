import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
// EDIT (Phase 7 — Member Limit Increase Requests, subphase 7.2): submit()'s
// organizer check reuses OrgService.assertOrganizerAccess() rather than
// reimplementing it — it's the exact same "does this uid hold an
// is_organizer=true role_roles row in this org" check
// trg_check_limit_request_organizer (7.1, dbschema.sql) already backstops at
// the DB level. This is the friendly 4xx in front of that trigger's raw
// exception, same "friendly guard in front of a DB-level backstop" pattern
// the plan calls for on 6.4's member-add paths.
import { OrgService } from './org.service';
// EDIT (Phase 7 — subphase 7.5): the four submitted/approved/rejected/
// needs-info notifications for this table's lifecycle — see that file's own
// header comment for why it's a sibling service to OrgRequestEmailService
// rather than new methods added to it.
import { OrgLimitRequestEmailService } from './org-limit-request-email.service';

// ─── Member limit increase requests (Phase 7 — subphase 7.2) ────────────────
// EDIT (Phase 7 — subphase 7.2): new service, structurally parallel to
// OrgRequestsService (org-requests.service.ts) but deliberately its own
// class/file rather than a method added to that one — see this plan's own
// Phase 7 intro (post-approval-org-setup-plan.md) for why the two request
// kinds (org creation vs. an existing org's member cap) stay separate all
// the way down: different FK shape (pid vs. (orgid, uid)), different
// approval side effect (org creation + finalizeSetup vs. a single-column
// UPDATE on organization), different actor (a unified account with no org
// yet vs. an existing org's own organizer).
//
// Scope note: submit()/approve()/reject()/requestInfo() below are 7.2's
// "Backend service" entry, unchanged since that subphase. list()/
// getDetail()/listForOrg() further down were added in 7.3 ("API surface")
// to back that subphase's new routes — 7.2 deliberately left them out (the
// plan's own 7.2 text names only the four write methods), same as
// OrgRequestsService's own history (2.3/2.4/2.5 shipped the write methods;
// 3.1 added list()/getDetail() once an admin controller needed them). The
// org_member_limit_requests table, its triggers, and the admin_review_queue
// view are already in place (7.1/7.1b, verified directly against
// dbschema.sql before writing this file — see the method comments below for
// exactly what each constraint/trigger already guarantees vs. what this
// service adds in front of it). Notifications (7.5) are wired into submit()/
// approve()/reject()/requestInfo() via OrgLimitRequestEmailService — see
// that file's own header comment for why it's a sibling service rather than
// new methods on OrgRequestEmailService.
//
// Cooldown: the plan's own "Open decisions" #3 is already answered — no
// cooldown between successive limit-increase requests for the same org
// (post-approval-org-setup-plan.md). unique_open_limit_request (one open
// request per org at a time) is the only submission gate; there is no
// SUBMIT_COOLDOWN_MS-equivalent constant in this file, and none should be
// added unless that decision is reversed.

/** Statuses in which a member-limit request is still awaiting a decision. */
export const OPEN_LIMIT_REQUEST_STATUSES = ['PENDING', 'NEEDS_INFO'] as const;

/** Mirrors org_member_limit_requests.chk_limit_request_status (7.1, dbschema.sql). */
export type OrgLimitRequestStatus =
  | 'PENDING'
  | 'NEEDS_INFO'
  | 'APPROVED'
  | 'REJECTED';

/**
 * Every status org_member_limit_requests.status can hold. Exported for
 * 7.1b's AdminReviewQueueService, which today defines its own local
 * ALL_LIMIT_REQUEST_STATUSES because this service didn't exist yet when it
 * was written (see that file's own comment flagging exactly this gap) —
 * whoever wires 7.3's admin routes should have AdminReviewQueueService
 * import this constant instead of keeping its local copy, to avoid the two
 * lists silently drifting apart.
 */
export const ALL_LIMIT_REQUEST_STATUSES = [
  'PENDING',
  'NEEDS_INFO',
  'APPROVED',
  'REJECTED',
] as const;

@Injectable()
export class OrgLimitRequestsService {
  constructor(
    private prisma: PrismaService,
    private orgService: OrgService,
    // EDIT (Phase 7 — subphase 7.5): wired in alongside orgService above,
    // same "inject the dispatch-mechanics service, decide when to call it
    // here" split OrgRequestsService/OrgRequestEmailService already use.
    private emailService: OrgLimitRequestEmailService,
  ) {}

  // ─── Submit a member-limit increase request ────────────────────────────────
  // EDIT (Phase 7 — subphase 7.2): organizer-only (enforced here as a
  // friendly pre-check, and again at the DB level by
  // trg_check_limit_request_organizer — see that trigger's own comment in
  // dbschema.sql for why it's not *only* a service-layer check), one open
  // request per org (unique_open_limit_request backstops this the same way
  // unique_open_org_request backstops OrgRequestsService.submit()), snapshots
  // current_limit from organization.member_limit at call time (same "fixed
  // at submission, not re-read later" reasoning
  // org_requests.requester_account_age_days already uses).
  async submit(
    orgid: string,
    uid: string,
    requestedLimit: number,
    justification?: string | null,
  ) {
    // Friendly guard in front of trg_check_limit_request_organizer's raw
    // exception. Does not, by itself, prove `uid` is a *current, non-deleted*
    // member — assertOrganizerAccess() only checks member_roles, same as
    // every other caller of it in org.service.ts today; not something this
    // subphase should tighten unilaterally.
    await this.orgService.assertOrganizerAccess(orgid, uid);

    const org = await this.prisma.organization.findUnique({
      where: { orgid },
      select: { org_name: true, member_limit: true, is_deleted: true },
    });
    // Unreachable in practice — assertOrganizerAccess() above already
    // implies org_members/member_roles rows exist for this orgid, and
    // organization has no delete path that leaves those rows behind
    // (mirrors the "unexercised guard" notes throughout
    // org-requests.service.ts). Kept as defense-in-depth, not a real branch.
    if (!org || org.is_deleted) {
      throw new NotFoundException(`Organization ${orgid} not found`);
    }

    // chk_limit_request_increase (requested_limit > current_limit) and
    // chk_limit_request_current_limit_positive back this up at the DB level
    // — this is the friendly version of that check, same "don't make the
    // caller learn about their mistake from a raw constraint-violation
    // error" reasoning as every other precondition check in this codebase.
    if (!Number.isInteger(requestedLimit)) {
      throw new BadRequestException('requested_limit must be an integer.');
    }
    if (requestedLimit <= org.member_limit) {
      throw new BadRequestException(
        `requested_limit (${requestedLimit}) must be greater than ${org.org_name}'s ` +
          `current member limit (${org.member_limit}).`,
      );
    }

    // Cheap pre-check for an existing open request on this org. Same
    // two-layer shape as OrgRequestsService.submit()'s own
    // findOpenRequestByName() pre-check: this does NOT close the race —
    // unique_open_limit_request (7.1) is what actually prevents the
    // duplicate — it just produces a useful message instead of a bare 409
    // when there's no race to lose.
    const existing = await this.findOpenRequestForOrg(orgid);
    if (existing) {
      throw new ConflictException(
        `${org.org_name} already has an open member-limit request ` +
          `(request ${existing.request_id}, status ${existing.status}). ` +
          `Wait for it to be resolved before submitting another.`,
      );
    }

    const trimmedJustification = justification?.trim() || null;

    try {
      const request = await this.prisma.org_member_limit_requests.create({
        data: {
          orgid,
          requested_by_uid: uid,
          current_limit: org.member_limit,
          requested_limit: requestedLimit,
          justification: trimmedJustification,
          // status defaults to 'PENDING' at the schema level, same reasoning
          // as OrgRequestsService.submit() leaving org_requests.status
          // unset.
        },
        select: {
          request_id: true,
          orgid: true,
          requested_by_uid: true,
          current_limit: true,
          requested_limit: true,
          justification: true,
          status: true,
          created_at: true,
        },
      });

      // EDIT (Phase 7 — subphase 7.5): fire the "request received"
      // notification now that the row genuinely exists — after the create
      // succeeds, not speculatively inside the try's happy path before
      // that, same "never email for a row that turned out not to exist"
      // reasoning as OrgRequestsService.submit()'s own call site. Awaited
      // for the same reason: dispatch() itself never throws, so this can't
      // turn a successful submission into a failed response.
      const requester = await this.prisma.org_members.findUnique({
        where: { orgid_uid: { orgid, uid } },
        select: { email: true },
      });
      await this.emailService.sendSubmitted(
        requester?.email ?? null,
        request.request_id,
        org.org_name,
        request.current_limit,
        request.requested_limit,
      );

      return {
        ...request,
        message:
          `Member limit increase request submitted for ${org.org_name} ` +
          `(current limit ${request.current_limit}, requested ${request.requested_limit}).`,
      };
    } catch (err) {
      // Lost the race against a concurrent second submission for the same
      // org — unique_open_limit_request caught it. Same
      // narrow-the-P2002-to-this-index approach as
      // OrgRequestsService.isOpenRequestConflict().
      if (this.isOpenLimitRequestConflict(err)) {
        throw new ConflictException(
          `${org.org_name} already has an open member-limit request. ` +
            `Wait for it to be resolved before submitting another.`,
        );
      }
      throw err;
    }
  }

  // ─── Approve a pending/needs-info request ────────────────────────────────
  // EDIT (Phase 7 — subphase 7.2): the one outcome with a real side effect —
  // organization.member_limit is raised to requested_limit in the same
  // transaction that closes the request out. Lock-then-write shape mirrors
  // OrgRequestsService.approve()/reject()/requestInfo() exactly: SELECT ...
  // FOR UPDATE locks the row first, so a concurrent reviewer on the same
  // request_id blocks until this transaction commits or rolls back, then
  // re-reads a status that's no longer open.
  async approve(requestId: bigint, adminId: string) {
    await this.requireActiveSiteAdmin(adminId);

    // Fast, unlocked pre-check purely for a friendly error — does not close
    // the race, the lock inside the transaction below does that. Same
    // two-layer shape as every review method in org-requests.service.ts.
    const request = await this.prisma.org_member_limit_requests.findUnique({
      where: { request_id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Member limit request ${requestId} not found`);
    }
    if (!this.isOpenStatus(request.status)) {
      throw new ConflictException(
        `Member limit request ${requestId} is already ${request.status} ` +
          `and cannot be approved.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          request_id: bigint;
          orgid: string;
          status: string;
          requested_limit: number;
          requested_by_uid: string;
        }>
      >`
        SELECT request_id, orgid, status, requested_limit, requested_by_uid
        FROM org_member_limit_requests
        WHERE request_id = ${requestId}
        FOR UPDATE
      `;
      const claimed = locked[0];
      // Only reachable if the row was deleted between the pre-fetch above
      // and here — org_member_limit_requests has no delete path anywhere in
      // this service (same unexercised-guard note as
      // org-requests.service.ts's own equivalents).
      if (!claimed) {
        throw new NotFoundException(`Member limit request ${requestId} not found`);
      }
      if (!this.isOpenStatus(claimed.status)) {
        throw new ConflictException(
          `Member limit request ${requestId} was already reviewed by someone else.`,
        );
      }

      // The actual grant. chk_org_member_limit_positive already guarantees
      // requested_limit > 0 transitively (chk_limit_request_increase forced
      // it to be greater than a current_limit that was itself positive at
      // submission time), so no redundant positivity check is needed here.
      await tx.organization.update({
        where: { orgid: claimed.orgid },
        data: { member_limit: claimed.requested_limit },
      });

      const updated = await tx.org_member_limit_requests.update({
        where: { request_id: requestId },
        data: {
          status: 'APPROVED',
          reviewed_by_admin_id: adminId,
          reviewed_at: new Date(),
        },
        select: {
          request_id: true,
          orgid: true,
          requested_limit: true,
          requested_by_uid: true,
          status: true,
        },
      });

      await tx.admin_audit_log.create({
        data: {
          admin_id: adminId,
          action: 'MEMBER_LIMIT_INCREASE_APPROVED',
          target_type: 'MEMBER_LIMIT_REQUEST',
          target_id: String(requestId),
          // reason left NULL — chk_admin_audit_reason_required leaves this
          // action optional, same "the request row itself is the
          // justification" treatment as ORG_REQUEST_APPROVED.
          metadata: {
            orgid: claimed.orgid,
            new_member_limit: claimed.requested_limit,
          },
        },
      });

      return updated;
    });

    // EDIT (Phase 7 — subphase 7.5): sent after the transaction commits —
    // same "don't email for something that got rolled back" reasoning as
    // every notification call site in org-requests.service.ts. Requester
    // email/org name aren't columns on org_member_limit_requests itself, so
    // both are looked up fresh here rather than threaded out of the
    // transaction above.
    const [requester, org] = await Promise.all([
      this.prisma.org_members.findUnique({
        where: {
          orgid_uid: { orgid: result.orgid, uid: result.requested_by_uid },
        },
        select: { email: true },
      }),
      this.prisma.organization.findUnique({
        where: { orgid: result.orgid },
        select: { org_name: true },
      }),
    ]);
    await this.emailService.sendApproved(
      requester?.email ?? null,
      requestId,
      org?.org_name ?? result.orgid,
      result.requested_limit,
    );

    return {
      request_id: requestId,
      status: result.status,
      orgid: result.orgid,
      new_member_limit: result.requested_limit,
      message: `Member limit request ${requestId} approved. ${result.orgid}'s member limit is now ${result.requested_limit}.`,
    };
  }

  // ─── Reject a pending/needs-info request ─────────────────────────────────
  // EDIT (Phase 7 — subphase 7.2): terminal, adverse outcome, no
  // organization.member_limit change. Same shape as
  // OrgRequestsService.reject().
  async reject(requestId: bigint, adminId: string, reason: string) {
    await this.requireActiveSiteAdmin(adminId);

    const request = await this.prisma.org_member_limit_requests.findUnique({
      where: { request_id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Member limit request ${requestId} not found`);
    }
    if (!this.isOpenStatus(request.status)) {
      throw new ConflictException(
        `Member limit request ${requestId} is already ${request.status} ` +
          `and cannot be rejected.`,
      );
    }

    const reviewNote = this.resolveReviewNote(reason);

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          request_id: bigint;
          orgid: string;
          status: string;
          requested_by_uid: string;
        }>
      >`
        SELECT request_id, orgid, status, requested_by_uid
        FROM org_member_limit_requests
        WHERE request_id = ${requestId}
        FOR UPDATE
      `;
      const claimed = locked[0];
      if (!claimed) {
        throw new NotFoundException(`Member limit request ${requestId} not found`);
      }
      if (!this.isOpenStatus(claimed.status)) {
        throw new ConflictException(
          `Member limit request ${requestId} was already reviewed by someone else.`,
        );
      }

      const updated = await tx.org_member_limit_requests.update({
        where: { request_id: requestId },
        data: {
          status: 'REJECTED',
          reviewed_by_admin_id: adminId,
          reviewed_at: new Date(),
          review_note: reviewNote,
        },
        select: {
          request_id: true,
          orgid: true,
          requested_by_uid: true,
          status: true,
        },
      });

      await tx.admin_audit_log.create({
        data: {
          admin_id: adminId,
          action: 'MEMBER_LIMIT_INCREASE_REJECTED',
          target_type: 'MEMBER_LIMIT_REQUEST',
          target_id: String(requestId),
          // Required — chk_admin_audit_reason_required lists
          // MEMBER_LIMIT_INCREASE_REJECTED alongside ORG_REQUEST_REJECTED as
          // adverse actions that must carry a justification.
          reason: reviewNote,
          metadata: { orgid: claimed.orgid },
        },
      });

      return updated;
    });

    // EDIT (Phase 7 — subphase 7.5): sent after the transaction commits,
    // same reasoning as approve()'s own call site above.
    const [requester, org] = await Promise.all([
      this.prisma.org_members.findUnique({
        where: {
          orgid_uid: { orgid: result.orgid, uid: result.requested_by_uid },
        },
        select: { email: true },
      }),
      this.prisma.organization.findUnique({
        where: { orgid: result.orgid },
        select: { org_name: true },
      }),
    ]);
    await this.emailService.sendRejected(
      requester?.email ?? null,
      requestId,
      org?.org_name ?? result.orgid,
      reviewNote,
    );

    return {
      ...result,
      message: `Member limit request ${requestId} has been rejected.`,
    };
  }

  // ─── Send a request back for more information ────────────────────────────
  // EDIT (Phase 7 — subphase 7.2): non-terminal — mirrors
  // OrgRequestsService.requestInfo() exactly. Writes
  // 'MEMBER_LIMIT_INCREASE_INFO_REQUESTED' to admin_audit_log — see this
  // file's accompanying dbschema.sql note (chk_admin_audit_action /
  // chk_admin_audit_reason_required) for why that value had to be added: 7.1
  // added APPROVED/REJECTED for this table but not an INFO_REQUESTED
  // counterpart, even though org_member_limit_requests.chk_limit_request_
  // status (7.1) already includes NEEDS_INFO as a reachable status and
  // chk_limit_request_needs_info_note already requires review_note for it —
  // the table-level support for this outcome was already there, only the
  // admin_audit_log enum value was missing. Flagging rather than silently
  // working around it (e.g. by reusing ORG_REQUEST_INFO_REQUESTED, which
  // would misattribute the action to the wrong table), same convention
  // 7.1/7.1b's own sessions used for gaps they found.
  async requestInfo(requestId: bigint, adminId: string, reason: string) {
    await this.requireActiveSiteAdmin(adminId);

    const request = await this.prisma.org_member_limit_requests.findUnique({
      where: { request_id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Member limit request ${requestId} not found`);
    }
    if (!this.isOpenStatus(request.status)) {
      throw new ConflictException(
        `Member limit request ${requestId} is already ${request.status} ` +
          `and cannot be sent back for more information.`,
      );
    }

    const reviewNote = this.resolveReviewNote(reason);

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          request_id: bigint;
          orgid: string;
          status: string;
          requested_by_uid: string;
        }>
      >`
        SELECT request_id, orgid, status, requested_by_uid
        FROM org_member_limit_requests
        WHERE request_id = ${requestId}
        FOR UPDATE
      `;
      const claimed = locked[0];
      if (!claimed) {
        throw new NotFoundException(`Member limit request ${requestId} not found`);
      }
      if (!this.isOpenStatus(claimed.status)) {
        throw new ConflictException(
          `Member limit request ${requestId} was already reviewed by someone else.`,
        );
      }

      const updated = await tx.org_member_limit_requests.update({
        where: { request_id: requestId },
        data: {
          status: 'NEEDS_INFO',
          reviewed_by_admin_id: adminId,
          reviewed_at: new Date(),
          review_note: reviewNote,
        },
        select: {
          request_id: true,
          orgid: true,
          requested_by_uid: true,
          status: true,
        },
      });

      await tx.admin_audit_log.create({
        data: {
          admin_id: adminId,
          action: 'MEMBER_LIMIT_INCREASE_INFO_REQUESTED',
          target_type: 'MEMBER_LIMIT_REQUEST',
          target_id: String(requestId),
          reason: reviewNote,
          metadata: { orgid: claimed.orgid },
        },
      });

      return updated;
    });

    // EDIT (Phase 7 — subphase 7.5): sent after the transaction commits,
    // same reasoning as approve()/reject()'s own call sites above.
    const [requester, org] = await Promise.all([
      this.prisma.org_members.findUnique({
        where: {
          orgid_uid: { orgid: result.orgid, uid: result.requested_by_uid },
        },
        select: { email: true },
      }),
      this.prisma.organization.findUnique({
        where: { orgid: result.orgid },
        select: { org_name: true },
      }),
    ]);
    await this.emailService.sendNeedsInfo(
      requester?.email ?? null,
      requestId,
      org?.org_name ?? result.orgid,
      reviewNote,
    );

    return {
      ...result,
      message: `Member limit request ${requestId} sent back to the organizer for more information.`,
    };
  }

  // ─── Admin review queue + detail (subphase 7.3) ──────────────────────────
  // EDIT (Phase 7 — Member Limit Increase Requests, subphase 7.3): read-side
  // methods 7.2 deliberately left out of scope (see this file's own header
  // comment) — the plan's "7.2 — Backend service" entry names only
  // submit/approve/reject/requestInfo. 7.3's admin routes
  // (member-limit-requests-admin.controller.ts) need a queue and a detail
  // view, same as OrgRequestsService.list()/getDetail() (3.1) do for
  // org_requests — mirrored here rather than reinvented.

  /**
   * The admin review queue for this table specifically. Defaults to open
   * requests only (PENDING + NEEDS_INFO), ordered oldest-first *within* a
   * status — matches idx_limit_requests_status's (status, created_at) shape
   * exactly, same reasoning as OrgRequestsService.list()'s own doc comment.
   *
   * Distinct from AdminReviewQueueService.list() (7.1b), which reads BOTH
   * request tables through the unified admin_review_queue view for the
   * combined queue UI — that view only carries the columns both tables
   * share (status/created_at/reviewed_by_admin_id/reviewed_at), not
   * requested_limit/current_limit/orgid-specific detail. This method is
   * what a queue-row click-through (or a member-limit-only queue view) uses
   * to get the full row.
   */
  async list(
    options: {
      status?: string[];
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const statuses = this.resolveStatusFilter(options.status);
    const page =
      options.page && options.page > 0 ? Math.floor(options.page) : 1;
    // Same 100-row cap as OrgRequestsService.list() — an admin queue, not a
    // public export endpoint.
    const pageSize =
      options.pageSize && options.pageSize > 0
        ? Math.min(Math.floor(options.pageSize), 100)
        : 25;

    const where = { status: { in: statuses } };

    const [total, requests] = await this.prisma.$transaction([
      this.prisma.org_member_limit_requests.count({ where }),
      this.prisma.org_member_limit_requests.findMany({
        where,
        orderBy: [{ status: 'asc' }, { created_at: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          request_id: true,
          orgid: true,
          requested_by_uid: true,
          current_limit: true,
          requested_limit: true,
          status: true,
          created_at: true,
          updated_at: true,
        },
      }),
    ]);

    return { requests, total, page, page_size: pageSize };
  }

  /**
   * Request detail: the request row, the org's name (for display — the row
   * itself only carries orgid), the requesting member's identity, the
   * reviewing admin if reviewed, and the full admin_audit_log trail for this
   * request (target_type 'MEMBER_LIMIT_REQUEST'). Same three-separate-
   * queries-not-a-Prisma-include shape as
   * OrgRequestsService.getDetail() — see that method's own comment for why
   * (the real Prisma-generated relation field names for these FKs aren't
   * knowable in this sandbox without a working `prisma generate`).
   */
  async getDetail(requestId: bigint) {
    const request = await this.prisma.org_member_limit_requests.findUnique({
      where: { request_id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Member limit request ${requestId} not found`);
    }

    const [org, requester, reviewer, auditTrail] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { orgid: request.orgid },
        select: { orgid: true, org_name: true },
      }),
      this.prisma.org_members.findUnique({
        where: {
          orgid_uid: { orgid: request.orgid, uid: request.requested_by_uid },
        },
        select: {
          orgid: true,
          uid: true,
          pid: true,
          email: true,
          mobile: true,
        },
      }),
      request.reviewed_by_admin_id
        ? this.prisma.site_admins.findUnique({
            where: { admin_id: request.reviewed_by_admin_id },
            select: { admin_id: true, name: true },
          })
        : Promise.resolve(null),
      this.prisma.admin_audit_log.findMany({
        where: {
          target_type: 'MEMBER_LIMIT_REQUEST',
          target_id: String(requestId),
        },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    return { ...request, organization: org, requester, reviewer, audit_trail: auditTrail };
  }

  /**
   * An org's own request history, newest first — 7.4's org-admin-dashboard
   * "status of any open request" view reads from this. Matches
   * idx_limit_requests_orgid's (orgid, created_at DESC) shape exactly, so
   * this is an index-only lookup for any one org, not a scan.
   */
  async listForOrg(orgid: string) {
    return this.prisma.org_member_limit_requests.findMany({
      where: { orgid },
      orderBy: { created_at: 'desc' },
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  /**
   * approve()/reject()/requestInfo()'s defense-in-depth admin check.
   * Deliberately duplicated from OrgRequestsService.requireActiveSiteAdmin()
   * rather than exported and shared — that method is private to its own
   * class, and this three-line check is small enough that reaching for a
   * shared base class or exported helper over it would cost more
   * indirection than it saves. Same reasoning/shape in both places: closes
   * the window where a token issued before an admin was deactivated stays
   * usable for the rest of its session (see
   * OrgRequestsService.requireActiveSiteAdmin()'s own comment for the full
   * explanation).
   */
  private async requireActiveSiteAdmin(adminId: string) {
    const admin = await this.prisma.site_admins.findUnique({
      where: { admin_id: adminId },
    });
    if (!admin || !admin.is_active) {
      throw new ForbiddenException(
        'This admin account is not active. Please sign in again.',
      );
    }
  }

  private isOpenStatus(
    status: string,
  ): status is (typeof OPEN_LIMIT_REQUEST_STATUSES)[number] {
    return (OPEN_LIMIT_REQUEST_STATUSES as readonly string[]).includes(
      status,
    );
  }

  /**
   * Validates+normalises list()'s optional status filter. Same shape as
   * OrgRequestsService.resolveStatusFilter() (3.1): empty/omitted defaults
   * to the open statuses, an explicit filter is upper-cased and checked
   * against the full status set so a typo produces a clean
   * BadRequestException instead of a silently-empty page.
   */
  private resolveStatusFilter(status?: string[]): OrgLimitRequestStatus[] {
    if (!status || status.length === 0) {
      return [...OPEN_LIMIT_REQUEST_STATUSES];
    }
    const normalized = status.map((s) => s.trim().toUpperCase());
    for (const s of normalized) {
      if (!(ALL_LIMIT_REQUEST_STATUSES as readonly string[]).includes(s)) {
        throw new BadRequestException(
          `Invalid status "${s}". Expected one of: ${ALL_LIMIT_REQUEST_STATUSES.join(', ')}.`,
        );
      }
    }
    return normalized as OrgLimitRequestStatus[];
  }

  /**
   * reject()/requestInfo()'s shared note validation. Unlike
   * OrgRequestsService.resolveReviewNotes(), this returns a single string
   * used for both the requester-facing review_note and the internal
   * admin_audit_log.reason — the plan's own 7.2 text describes reject()/
   * requestInfo() as "same shape as the existing org_requests equivalents"
   * but does not carry over ReviewOrgRequestDto's separate
   * reason/internal_note split; that split is a DTO-level decision (7.3),
   * not something implied by the service signatures the plan gives for 7.2
   * (`reject(requestId, adminId, reason)`). If 7.3 wants the same
   * public/internal split org_requests has, this method's signature — and
   * this helper — will need to grow a second parameter then, not now.
   */
  private resolveReviewNote(reason: string): string {
    const trimmed = reason?.trim() ?? '';
    if (trimmed.length === 0) {
      throw new BadRequestException(
        'A reason is required — it will be shown to the organizer.',
      );
    }
    return trimmed;
  }

  /**
   * Case-sensitive-on-orgid lookup of the org's open request, if any.
   * Matches the shape of the unique_open_limit_request partial index
   * (orgid) WHERE status IN ('PENDING','NEEDS_INFO').
   */
  private async findOpenRequestForOrg(orgid: string) {
    return this.prisma.org_member_limit_requests.findFirst({
      where: { orgid, status: { in: [...OPEN_LIMIT_REQUEST_STATUSES] } },
      select: { request_id: true, status: true },
    });
  }

  /**
   * Narrow a Prisma unique violation to unique_open_limit_request
   * specifically, so an unrelated unique collision isn't misreported as a
   * duplicate submission. Same approach as
   * OrgRequestsService.isOpenRequestConflict() / orgid.utilities.ts's
   * isOrgIdUniqueConflict().
   */
  private isOpenLimitRequestConflict(err: unknown): boolean {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (err.code !== 'P2002') return false;
    const target = err.meta?.target;
    const targetStr = Array.isArray(target)
      ? target.join(',')
      : String(target ?? '');
    return targetStr.includes('unique_open_limit_request');
  }
}
