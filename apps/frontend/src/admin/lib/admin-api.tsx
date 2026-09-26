import { toast } from "sonner";

// EDIT (Phase 1 — auth model consolidation, subphase 1.10): standalone
// admin-app API client. Deliberately its own small file rather than
// extending src/lib/api.tsx — that file's request() helper, CSRF handling,
// and 401 redirect all key off the ovp_token/ovp_csrf cookie pair (see its
// own comments); the admin app uses the separate ovp_admin_token/
// ovp_admin_csrf pair (subphase 1.3) and has a different set of routes
// (send-admin-login-otp / admin-login / admin-csrf-token / admin-logout /
// admin-profile — see auth.controller.ts's "Admin app routes" section).
// Sharing one request() across both cookie pairs would mean every call
// site has to say which pair it means; two small files with the same
// shape is simpler than one file with a "which session" parameter
// threaded through every method.
const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// ── CSRF helper ──────────────────────────────────────────────────────────────
// Same in-memory + sessionStorage mirror pattern as lib/api.tsx, under a
// distinct storage key so a regular user session and an admin session open
// in different tabs of the same browser never clobber each other's token.
const CSRF_STORAGE_KEY = "ovp_admin_csrf_token";
let csrfTokenMemory: string | null = (() => {
  try {
    return sessionStorage.getItem(CSRF_STORAGE_KEY);
  } catch {
    return null; // sessionStorage unavailable (e.g. private mode edge cases)
  }
})();

function getCsrfToken(): string | null {
  return csrfTokenMemory;
}

function setCsrfToken(token: string | null): void {
  csrfTokenMemory = token;
  try {
    if (token) {
      sessionStorage.setItem(CSRF_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(CSRF_STORAGE_KEY);
    }
  } catch {
    // sessionStorage unavailable — in-memory copy still works for this page life
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ── Base request ──────────────────────────────────────────────────────────────
// `silent401`: skip the redirect-to-`/` on a 401 and just reject instead —
// needed for the boot-time "am I logged in" probe (getAdminProfile), where
// an unauthenticated visitor is an expected outcome, not a session that
// just expired mid-use. Mirrors lib/api.tsx's request() one-for-one.
async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: { silent401?: boolean } = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const csrfToken = getCsrfToken();

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include", // send the httpOnly ovp_admin_token cookie
    headers: {
      "Content-Type": "application/json",
      ...(MUTATING_METHODS.has(method) && csrfToken
        ? { "X-CSRF-Token": csrfToken }
        : {}),
      ...init.headers,
    },
  });

  if (res.status === 401) {
    if (opts.silent401) {
      throw new Error("Unauthorized");
    }
    window.location.href = "/admin";
    return new Promise(() => {});
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }

  const data: any = await res.json();

  if (data?.otp) {
    toast(
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <strong>DEV OTP</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "monospace", fontSize: 16 }}>
            {data.otp}
          </span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(data.otp);
              toast.success("Copied!");
            }}
            style={{
              padding: "2px 8px",
              fontSize: 12,
              border: "1px solid #ccc",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Copy
          </button>
        </div>
      </div>,
    );
  }

  return data;
}

// ── Auth types ────────────────────────────────────────────────────────────────

/** Mirrors JwtUser (current-user.decorator.ts) for a SITEADMIN session. */
export interface AdminProfile {
  type: "SITEADMIN";
  admin_id: string;
  is_super_admin: boolean;
  session_id: string;
}

// ── Org request types (Phase 3 — admin portal core, subphase 3.5) ──────────
// Mirror org-requests.service.ts's (Phase 2/3.1) plain-object return shapes
// exactly — no Prisma types are shared across the app/backend boundary, so
// these are hand-written to match. `request_id`/`pid`/`admin_log_id` all
// come back as strings, not numbers: BigIntInterceptor (backend, applies
// globally) stringifies every bigint in the JSON response, since
// org_requests.request_id/uaccount.pid/admin_audit_log.admin_log_id are all
// BIGSERIAL/BIGINT in the schema.

// EDIT (Phase 6 — post-approval org setup, subphase 6.6): added
// 'APPROVED_PENDING_SETUP' — reachable from approve() (6.2) now that it no
// longer creates the organization itself. Mirrors OrgRequestStatus in
// org-requests.service.ts exactly.
export type OrgRequestStatus =
  | "PENDING"
  | "NEEDS_INFO"
  | "APPROVED_PENDING_SETUP"
  | "APPROVED"
  | "REJECTED";

/** One row of GET /admin/org-requests — OrgRequestsService.list()'s select shape. */
export interface OrgRequestListItem {
  request_id: string;
  reference_code: string;
  org_name: string;
  org_email: string | null;
  expected_member_count: number | null;
  status: OrgRequestStatus;
  created_at: string;
  updated_at: string;
  pid: string;
}

/**
 * One row of GET /admin/org-requests/pending-setup/stuck —
 * OrgRequestsService.listStuckPendingSetup()'s select shape (6.6). Narrower
 * than OrgRequestListItem: every row here is APPROVED_PENDING_SETUP by
 * construction, so `status` isn't repeated, and `reviewed_at`/
 * `reviewed_by_admin_id` (not part of the plain list view) are what this
 * view is actually sorted and read by.
 */
export interface StuckOrgRequestItem {
  request_id: string;
  reference_code: string;
  org_name: string;
  org_email: string | null;
  admin_set_member_limit: number | null;
  reviewed_at: string | null;
  reviewed_by_admin_id: string | null;
  pid: string;
}

export interface StuckOrgRequestsResponse {
  requests: StuckOrgRequestItem[];
  min_hours: number;
  count: number;
}

export interface OrgRequestListResponse {
  requests: OrgRequestListItem[];
  total: number;
  page: number;
  page_size: number;
}

/** One admin_audit_log row, as returned in getDetail()'s audit_trail array. */
export interface AdminAuditLogEntry {
  admin_log_id: string;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** GET /admin/org-requests/:requestId — OrgRequestsService.getDetail()'s shape. */
export interface OrgRequestDetail {
  request_id: string;
  reference_code: string;
  pid: string;
  org_name: string;
  org_email: string | null;
  expected_member_count: number | null;
  justification: string | null;
  status: OrgRequestStatus;
  reviewed_by_admin_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  approved_orgid: string | null;
  // EDIT (Phase 6 — post-approval org setup, subphase 6.6): the admin-set
  // member cap (6.2) — shown on the detail page once a request has moved
  // past PENDING/NEEDS_INFO, and what the approve dialog pre-fills from
  // expected_member_count above.
  admin_set_member_limit: number | null;
  setup_completed_at: string | null;
  created_at: string;
  updated_at: string;
  requester: {
    pid: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    email: string | null;
    mobile: string | null;
  } | null;
  reviewer: { admin_id: string; name: string } | null;
  audit_trail: AdminAuditLogEntry[];
}

/** Body for POST .../reject and .../request-info — mirrors ReviewOrgRequestDto. */
export interface ReviewOrgRequestBody {
  reason: string;
  internal_note?: string;
}

// ── Member limit increase requests (Phase 7 — Member Limit Increase
// Requests, subphase 7.4) ───────────────────────────────────────────────────
// Types mirror OrgLimitRequestsService's (7.2/7.3) plain-object return shapes,
// same hand-written-not-shared-Prisma-types convention as the org-request
// types above. Deliberately their own interfaces rather than reusing
// OrgRequestListItem/OrgRequestDetail — org_member_limit_requests has no
// reference_code/pid/expected_member_count, and carries current_limit/
// requested_limit, which org_requests has no equivalent of; the two tables'
// shapes only overlap on request_id/status/created_at/reviewed_* (which is
// exactly what AdminReviewQueueRow below narrows down to).

export type MemberLimitRequestStatus =
  | "PENDING"
  | "NEEDS_INFO"
  | "APPROVED"
  | "REJECTED";

/** One row of GET /admin/member-limit-requests — OrgLimitRequestsService.list()'s select shape. */
export interface MemberLimitRequestListItem {
  request_id: string;
  orgid: string;
  requested_by_uid: string;
  current_limit: number;
  requested_limit: number;
  status: MemberLimitRequestStatus;
  created_at: string;
  updated_at: string;
}

export interface MemberLimitRequestListResponse {
  requests: MemberLimitRequestListItem[];
  total: number;
  page: number;
  page_size: number;
}

/** GET /admin/member-limit-requests/:requestId — OrgLimitRequestsService.getDetail()'s shape. */
export interface MemberLimitRequestDetail {
  request_id: string;
  orgid: string;
  requested_by_uid: string;
  current_limit: number;
  requested_limit: number;
  justification: string | null;
  status: MemberLimitRequestStatus;
  reviewed_by_admin_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  organization: { orgid: string; org_name: string } | null;
  requester: {
    orgid: string;
    uid: string;
    pid: string | null;
    email: string | null;
    mobile: string | null;
  } | null;
  reviewer: { admin_id: string; name: string } | null;
  audit_trail: AdminAuditLogEntry[];
}

/**
 * Body for POST .../reject and .../needs-info. Unlike ReviewOrgRequestBody,
 * there is no separate `internal_note` — see ReviewLimitRequestDto's (7.3)
 * own header comment for why: this single `reason` lands as both the
 * organizer-facing review_note and the internal admin_audit_log.reason.
 */
export interface ReviewLimitRequestBody {
  reason: string;
}

// ── Unified admin review queue (Phase 7 — subphase 7.1b/7.4) ───────────────
// GET /admin/review-queue's row shape — the columns org_requests and
// org_member_limit_requests actually share (AdminReviewQueueService's own
// comment). `request_type` is what a queue-row click-through uses to decide
// between getOrgRequestDetail()/getMemberLimitRequestDetail() — the two
// review screens stay separate components, only this list is merged (7.1b's
// own plan text).

export type AdminReviewQueueRequestType =
  | "ORG_CREATION"
  | "MEMBER_LIMIT_INCREASE";

export interface AdminReviewQueueRow {
  id: string;
  request_type: AdminReviewQueueRequestType;
  status: string;
  created_at: string;
  reviewed_by_admin_id: string | null;
  reviewed_at: string | null;
}

export interface AdminReviewQueueResponse {
  requests: AdminReviewQueueRow[];
  total: number;
  page: number;
  page_size: number;
}


// ── Org directory / lifecycle types (Phase 3 — admin portal core, 3.6) ─────
// Mirror OrgDirectoryService's (3.3) and OrgLifecycleService's (3.2) plain-
// object return shapes exactly, same hand-written-not-shared-Prisma-types
// convention the org-request types above already follow. `organization.
// orgid` is a VARCHAR PK (not BIGSERIAL), so unlike request_id/pid above it
// comes back as a plain string already — no BigIntInterceptor stringification
// involved for it specifically, though admin_log_id in audit_trail is still
// bigint-stringified same as everywhere else.

export type OrgStatus = "ACTIVE" | "SUSPENDED" | "ARCHIVED";

/** OrgDirectoryService's getCounts() shape, shared by list() rows and getDetail(). */
export interface OrgCounts {
  member_count: number;
  scope_count: number;
  events: {
    active: number;
    completed: number;
    cancelled: number;
    total: number;
  };
}

/** One row of GET /admin/organizations — OrgDirectoryService.list()'s select + counts. */
export interface OrgListItem extends OrgCounts {
  orgid: string;
  org_name: string;
  org_email: string | null;
  status: OrgStatus;
  created_at: string;
}

export interface OrgListResponse {
  organizations: OrgListItem[];
  total: number;
  page: number;
  page_size: number;
}

/** GET /admin/organizations/:orgid — OrgDirectoryService.getDetail()'s shape. */
export interface OrgDetail extends OrgCounts {
  orgid: string;
  org_name: string;
  org_email: string | null;
  status: OrgStatus;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  audit_trail: AdminAuditLogEntry[];
}

/** Body for the three lifecycle POST routes — mirrors OrgLifecycleReasonDto. */
export interface OrgLifecycleBody {
  reason?: string;
}

/** Shared response shape of suspend()/reinstate()/archive(). */
export interface OrgLifecycleResult {
  orgid: string;
  org_name: string;
  status: OrgStatus;
  message: string;
}

// ── Audit viewer types (Phase 5 — platform maturity, subphase 5.1) ─────────
// Mirror AuditService's plain-object return shapes, same hand-written-not-
// shared-Prisma-types convention as everything above. `admin_log_id` and
// `log_id` differ in kind: admin_audit_log.admin_log_id is BIGSERIAL and so
// arrives BigIntInterceptor-stringified, while audit_logs.log_id is a plain
// SERIAL (int4) and arrives as a real number — that asymmetry is in the
// schema, not a typo here.

export type AdminAction =
  | "ORG_REQUEST_APPROVED"
  | "ORG_REQUEST_REJECTED"
  | "ORG_REQUEST_INFO_REQUESTED"
  | "ORG_SUSPENDED"
  | "ORG_REINSTATED"
  | "ORG_ARCHIVED"
  | "ADMIN_INVITED"
  | "ADMIN_DEACTIVATED";

export type AdminTargetType = "ORG_REQUEST" | "ORGANIZATION" | "SITE_ADMIN";

export interface AuditFeedResponse {
  entries: AdminAuditLogEntry[];
  total: number;
  page: number;
  page_size: number;
}

/** One audit_logs row — a row diff, as returned by the two drill-downs. */
export interface AuditRowDiff {
  log_id: number;
  table_name: string;
  operation: string;
  changed_at: string;
  changed_by: string | null;
  changed_data: Record<string, unknown> | null;
}

/** GET /admin/audit/:adminLogId — the entry plus its same-transaction diffs. */
export interface AuditEntryDetail extends AdminAuditLogEntry {
  admin: { admin_id: string; name: string; is_active: boolean } | null;
  changes: AuditRowDiff[];
}

/** GET /admin/audit/organizations/:orgid — the per-org change history. */
export interface OrgChangesResponse {
  organization: {
    orgid: string;
    org_name: string;
    status: OrgStatus;
    is_deleted: boolean;
  };
  changes: AuditRowDiff[];
  total: number;
  page: number;
  page_size: number;
  available_tables: string[];
}

// ── Analytics types (Phase 5 — platform maturity, subphase 5.2) ────────────
// Mirror AnalyticsService's return shapes. Everything here is a count —
// there is no row-shaped type in this block, which is the point (see that
// service's header on what it may and may not aggregate).

export type AnalyticsMetric =
  | "organizations"
  | "org_requests"
  | "events"
  | "ballots"
  | "accounts";

export type AnalyticsInterval = "day" | "week" | "month";

export interface StatusTally {
  total: number;
  by_status: Record<string, number>;
}

/** GET /admin/analytics/summary — current-state headline counts. */
export interface AnalyticsSummary {
  organizations: StatusTally;
  org_requests: StatusTally & { open: number };
  events: StatusTally;
  ballots_cast: number;
  accounts: number;
  org_memberships: number;
  active_site_admins: number;
}

/**
 * One bucket of a series. `by_status` is present only for the three
 * breakdown metrics; `ballots` and `accounts` carry `total` alone, and the
 * ballots series deliberately has no breakdown dimension at all.
 */
export interface AnalyticsPoint {
  bucket: string;
  total: number;
  by_status?: Record<string, number>;
}

/** GET /admin/analytics/series. `points` is dense — zero-filled server-side. */
export interface AnalyticsSeries {
  metric: AnalyticsMetric;
  interval: AnalyticsInterval;
  from: string;
  to: string;
  statuses: string[] | null;
  points: AnalyticsPoint[];
  total: number;
}

// ── Admin account management types (Phase 5 — platform maturity, 5.3) ──────
// Mirror AdminAccountsService's plain-object return shapes, same hand-
// written-not-shared-Prisma-types convention as everything above.
// site_admins.admin_id is a VARCHAR PK (not BIGSERIAL), so — like
// organization.orgid — it arrives as a plain string already, no
// BigIntInterceptor stringification involved.

/** One row of site_admins, as returned by list()/getDetail()/invite()/deactivate(). */
export interface SiteAdmin {
  admin_id: string;
  name: string;
  email: string;
  mobile: string | null;
  is_super_admin: boolean;
  is_active: boolean;
  created_at: string;
}

/** GET /admin/admins — AdminAccountsService.list()'s shape. */
export interface AdminAccountListResponse {
  admins: SiteAdmin[];
  total: number;
  page: number;
  page_size: number;
}

/** GET /admin/admins/:adminId — AdminAccountsService.getDetail()'s shape. */
export interface AdminAccountDetail extends SiteAdmin {
  audit_trail: AdminAuditLogEntry[];
}

/** Body for POST /admin/admins — mirrors InviteAdminDto. */
export interface InviteAdminBody {
  name: string;
  email: string;
  mobile?: string;
  is_super_admin?: boolean;
  reason?: string;
}

/** inviteAdmin()'s return shape — the new SiteAdmin row plus a message. */
export interface InviteAdminResult extends SiteAdmin {
  message: string;
}

/** Body for POST /admin/admins/:adminId/deactivate — mirrors DeactivateAdminDto. */
export interface DeactivateAdminBody {
  reason: string;
}

/** deactivateAdmin()'s return shape — the updated SiteAdmin row plus a message. */
export interface DeactivateAdminResult extends SiteAdmin {
  message: string;
}

// ── API ───────────────────────────────────────────────────────────────────────
export const adminApi = {
  sendAdminLoginOtp: (adminId: string) =>
    request("/auth/send-admin-login-otp", {
      method: "POST",
      body: JSON.stringify({ admin_id: adminId }),
    }),

  adminLogin: async (adminId: string, otp: string) => {
    const res = await request<{ message: string; csrf_token: string }>(
      "/auth/admin-login",
      {
        method: "POST",
        body: JSON.stringify({ admin_id: adminId, otp }),
      },
    );
    setCsrfToken(res.csrf_token);
    return res;
  },

  adminLogout: async () => {
    const res = await request("/auth/admin-logout", { method: "POST" });
    setCsrfToken(null);
    return res;
  },

  // Rehydrates the CSRF token from a still-valid admin session cookie when
  // we don't have one in memory/sessionStorage yet — e.g. a fresh tab. Call
  // at app boot alongside getAdminProfile(). See lib/api.tsx's
  // hydrateCsrfToken() for the full rationale; identical shape here.
  hydrateAdminCsrfToken: async () => {
    if (getCsrfToken()) return;
    try {
      const res = await request<{ csrf_token: string }>(
        "/auth/admin-csrf-token",
        {},
        { silent401: true },
      );
      setCsrfToken(res.csrf_token);
    } catch {
      // no valid admin session — nothing to hydrate
    }
  },

  getAdminProfile: (opts?: { silent401?: boolean }) =>
    request<AdminProfile>("/auth/admin-profile", {}, opts),

  // ── Org requests (Phase 3 — admin portal core, subphase 3.5) ─────────────
  // Thin wrappers over OrgRequestsAdminController's five routes (3.1). Every
  // call here relies on the ovp_admin_token/ovp_admin_csrf cookie pair
  // already set by adminLogin() above, same as every other method in this
  // file — nothing new to authenticate.

  /**
   * GET /admin/org-requests. `status` mirrors the controller's own
   * comma-separated `?status=` param (e.g. ['PENDING','NEEDS_INFO']) —
   * omit it to get the service's own open-requests-only default.
   */
  listOrgRequests: (params?: {
    status?: OrgRequestStatus[];
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status?.length) qs.set("status", params.status.join(","));
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("page_size", String(params.pageSize));
    const query = qs.toString();
    return request<OrgRequestListResponse>(
      `/admin/org-requests${query ? `?${query}` : ""}`,
    );
  },

  getOrgRequestDetail: (requestId: string) =>
    request<OrgRequestDetail>(
      `/admin/org-requests/${encodeURIComponent(requestId)}`,
    ),

  /**
   * GET /admin/org-requests/pending-setup/stuck (6.6). `minHours` mirrors
   * the backend's own default (24) when omitted — passed through as a
   * plain optional so this file doesn't have to re-decide that default.
   */
  listStuckPendingSetupRequests: (minHours?: number) => {
    const qs = new URLSearchParams();
    if (minHours !== undefined) qs.set("min_hours", String(minHours));
    const query = qs.toString();
    return request<StuckOrgRequestsResponse>(
      `/admin/org-requests/pending-setup/stuck${query ? `?${query}` : ""}`,
    );
  },

  // EDIT (Phase 6 — post-approval org setup, subphase 6.2/6.6): approve()
  // now takes a required `member_limit` and no longer creates the
  // organization itself — it only moves the request to
  // APPROVED_PENDING_SETUP. See ApproveOrgRequestDto / OrgRequestsService.
  // approve()'s own comments for why. This replaces the pre-6.2 no-body
  // call and its orgid-bearing response shape.
  approveOrgRequest: (requestId: string, body: { member_limit: number }) =>
    request<{
      request_id: string;
      status: OrgRequestStatus;
      reference_code: string;
      org_name: string;
      admin_set_member_limit: number;
      message: string;
    }>(`/admin/org-requests/${encodeURIComponent(requestId)}/approve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * POST .../revoke-approval (6.6) — only valid on an
   * APPROVED_PENDING_SETUP request; see OrgRequestsService.revokeApproval().
   * Same ReviewOrgRequestBody shape as reject()/requestInfo() below.
   */
  revokeOrgRequestApproval: (requestId: string, body: ReviewOrgRequestBody) =>
    request<{
      request_id: string;
      reference_code: string;
      org_name: string;
      status: OrgRequestStatus;
      message: string;
    }>(
      `/admin/org-requests/${encodeURIComponent(requestId)}/revoke-approval`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  rejectOrgRequest: (requestId: string, body: ReviewOrgRequestBody) =>
    request<{
      request_id: string;
      reference_code: string;
      org_name: string;
      status: OrgRequestStatus;
      message: string;
    }>(`/admin/org-requests/${encodeURIComponent(requestId)}/reject`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  requestInfoOnOrgRequest: (requestId: string, body: ReviewOrgRequestBody) =>
    request<{
      request_id: string;
      reference_code: string;
      org_name: string;
      status: OrgRequestStatus;
      message: string;
    }>(`/admin/org-requests/${encodeURIComponent(requestId)}/request-info`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Member limit increase requests (Phase 7 — subphase 7.4) ──────────────
  // Thin wrappers over MemberLimitRequestsAdminController's five routes
  // (7.3), same shape as the org-request wrappers just above.

  /**
   * GET /admin/member-limit-requests. `status` mirrors the controller's own
   * comma-separated `?status=` param — omit it for the service's own
   * open-requests-only default.
   */
  listMemberLimitRequests: (params?: {
    status?: MemberLimitRequestStatus[];
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status?.length) qs.set("status", params.status.join(","));
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("page_size", String(params.pageSize));
    const query = qs.toString();
    return request<MemberLimitRequestListResponse>(
      `/admin/member-limit-requests${query ? `?${query}` : ""}`,
    );
  },

  getMemberLimitRequestDetail: (requestId: string) =>
    request<MemberLimitRequestDetail>(
      `/admin/member-limit-requests/${encodeURIComponent(requestId)}`,
    ),

  /**
   * POST .../approve — no body. Unlike approveOrgRequest(), which needs an
   * admin-chosen `member_limit` (org_requests has no requested number of its
   * own), this table already carries `requested_limit` on the row itself —
   * see MemberLimitRequestsAdminController.approve()'s own comment.
   */
  approveMemberLimitRequest: (requestId: string) =>
    request<{
      request_id: string;
      status: MemberLimitRequestStatus;
      orgid: string;
      new_member_limit: number;
      message: string;
    }>(`/admin/member-limit-requests/${encodeURIComponent(requestId)}/approve`, {
      method: "POST",
    }),

  rejectMemberLimitRequest: (requestId: string, body: ReviewLimitRequestBody) =>
    request<{
      request_id: string;
      orgid: string;
      status: MemberLimitRequestStatus;
      message: string;
    }>(`/admin/member-limit-requests/${encodeURIComponent(requestId)}/reject`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * POST .../needs-info — note the route segment differs from
   * requestInfoOnOrgRequest()'s 'request-info', matching
   * MemberLimitRequestsAdminController's own literal route naming (7.3's own
   * comment flags this inconsistency rather than silently normalising it).
   */
  requestInfoOnMemberLimitRequest: (
    requestId: string,
    body: ReviewLimitRequestBody,
  ) =>
    request<{
      request_id: string;
      orgid: string;
      status: MemberLimitRequestStatus;
      message: string;
    }>(
      `/admin/member-limit-requests/${encodeURIComponent(requestId)}/needs-info`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  // ── Unified admin review queue (Phase 7 — subphase 7.1b/7.4) ─────────────
  /**
   * GET /admin/review-queue. Both `status` and `requestType` mirror the
   * controller's own comma-separated params — the admin-request-queue page
   * (7.4) reads from this instead of listOrgRequests() alone, so both
   * request kinds show up in one list with a `request_type` badge.
   */
  listReviewQueue: (params?: {
    status?: string[];
    requestType?: AdminReviewQueueRequestType[];
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status?.length) qs.set("status", params.status.join(","));
    if (params?.requestType?.length)
      qs.set("request_type", params.requestType.join(","));
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("page_size", String(params.pageSize));
    const query = qs.toString();
    return request<AdminReviewQueueResponse>(
      `/admin/review-queue${query ? `?${query}` : ""}`,
    );
  },

  // ── Org directory / lifecycle (Phase 3 — admin portal core, subphase 3.6) ─
  // Thin wrappers over OrgAdminController's five routes (3.3). Same
  // already-authenticated-by-adminLogin() cookie pair as everything above.

  /**
   * GET /admin/organizations. `status` mirrors the controller's own
   * comma-separated `?status=` param — omit it to get every non-deleted
   * organization regardless of status (list()'s own directory-not-a-queue
   * default; see its comment).
   */
  listOrganizations: (params?: {
    status?: OrgStatus[];
    search?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status?.length) qs.set("status", params.status.join(","));
    if (params?.search) qs.set("search", params.search);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("page_size", String(params.pageSize));
    const query = qs.toString();
    return request<OrgListResponse>(
      `/admin/organizations${query ? `?${query}` : ""}`,
    );
  },

  getOrganizationDetail: (orgid: string) =>
    request<OrgDetail>(`/admin/organizations/${encodeURIComponent(orgid)}`),

  /** ACTIVE -> SUSPENDED. `reason` is required (enforced server-side). */
  suspendOrganization: (orgid: string, body: OrgLifecycleBody) =>
    request<OrgLifecycleResult>(
      `/admin/organizations/${encodeURIComponent(orgid)}/suspend`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  /** SUSPENDED -> ACTIVE. `reason` is optional. */
  reinstateOrganization: (orgid: string, body?: OrgLifecycleBody) =>
    request<OrgLifecycleResult>(
      `/admin/organizations/${encodeURIComponent(orgid)}/reinstate`,
      { method: "POST", body: JSON.stringify(body ?? {}) },
    ),

  /** ACTIVE or SUSPENDED -> ARCHIVED, terminal. `reason` is required. */
  archiveOrganization: (orgid: string, body: OrgLifecycleBody) =>
    request<OrgLifecycleResult>(
      `/admin/organizations/${encodeURIComponent(orgid)}/archive`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  // ── Audit viewer (Phase 5 — platform maturity, subphase 5.1) ─────────────
  // Thin wrappers over AuditAdminController's three routes. Read-only —
  // nothing in that module writes, and admin_audit_log is append-only at
  // the DB level regardless.

  /**
   * GET /admin/audit. Every filter is optional and additive; omitting all
   * of them returns the complete reverse-chronological record, which is
   * AuditService.listAdminActions()'s deliberate no-default-subset
   * behaviour (an audit log that hides rows by default isn't one).
   */
  listAuditEntries: (params?: {
    adminId?: string;
    action?: AdminAction[];
    targetType?: AdminTargetType;
    targetId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.adminId) qs.set("admin_id", params.adminId);
    if (params?.action?.length) qs.set("action", params.action.join(","));
    if (params?.targetType) qs.set("target_type", params.targetType);
    if (params?.targetId) qs.set("target_id", params.targetId);
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("page_size", String(params.pageSize));
    const query = qs.toString();
    return request<AuditFeedResponse>(
      `/admin/audit${query ? `?${query}` : ""}`,
    );
  },

  /** GET /admin/audit/:adminLogId — one action + the rows it moved. */
  getAuditEntryDetail: (adminLogId: string) =>
    request<AuditEntryDetail>(`/admin/audit/${encodeURIComponent(adminLogId)}`),

  /**
   * GET /admin/audit/organizations/:orgid — every audited row change
   * touching this org. `table` must be one of the response's own
   * `available_tables`; omit it for all of them.
   */
  listOrgAuditChanges: (
    orgid: string,
    params?: { table?: string; page?: number; pageSize?: number },
  ) => {
    const qs = new URLSearchParams();
    if (params?.table) qs.set("table", params.table);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("page_size", String(params.pageSize));
    const query = qs.toString();
    return request<OrgChangesResponse>(
      `/admin/audit/organizations/${encodeURIComponent(orgid)}${
        query ? `?${query}` : ""
      }`,
    );
  },

  // ── Analytics (Phase 5 — platform maturity, subphase 5.2) ────────────────
  // Two GETs over AnalyticsAdminController. Read-only aggregates; no method
  // here takes an orgid or an event id, by design.

  /** GET /admin/analytics/summary — no parameters; "right now" by definition. */
  getAnalyticsSummary: () =>
    request<AnalyticsSummary>("/admin/analytics/summary"),

  /**
   * GET /admin/analytics/series. Every parameter is optional — the server
   * defaults to the organizations metric, month buckets, and the last 12
   * months. That bounded default is deliberate on the backend (it keeps the
   * ballots query on an index rather than a full scan), so this client does
   * not override it with a wider one.
   */
  getAnalyticsSeries: (params?: {
    metric?: AnalyticsMetric;
    interval?: AnalyticsInterval;
    from?: string;
    to?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.metric) qs.set("metric", params.metric);
    if (params?.interval) qs.set("interval", params.interval);
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    const query = qs.toString();
    return request<AnalyticsSeries>(
      `/admin/analytics/series${query ? `?${query}` : ""}`,
    );
  },

  // ── Admin account management (Phase 5 — platform maturity, subphase 5.3) ─
  // Thin wrappers over AdminAccountsController's four routes. Unlike every
  // other admin surface in this file, every route here is
  // @RequireSuperAdmin()-gated server-side, not just @UseGuards(SiteAdminGuard)
  // — an ordinary (non-super) admin session will get a 403 from all four.

  /**
   * GET /admin/admins. `isActive` mirrors the controller's own
   * `?is_active=true|false` — omit it to see every account regardless of
   * status (AdminAccountsService.list()'s own no-default-filter roster).
   */
  listAdminAccounts: (params?: {
    isActive?: boolean;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.isActive !== undefined)
      qs.set("is_active", String(params.isActive));
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("page_size", String(params.pageSize));
    const query = qs.toString();
    return request<AdminAccountListResponse>(
      `/admin/admins${query ? `?${query}` : ""}`,
    );
  },

  getAdminAccountDetail: (adminId: string) =>
    request<AdminAccountDetail>(`/admin/admins/${encodeURIComponent(adminId)}`),

  /** No accept-invite step — the new admin can sign in immediately. */
  inviteAdmin: (body: InviteAdminBody) =>
    request<InviteAdminResult>("/admin/admins", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** `reason` is required (enforced server-side). */
  deactivateAdmin: (adminId: string, body: DeactivateAdminBody) =>
    request<DeactivateAdminResult>(
      `/admin/admins/${encodeURIComponent(adminId)}/deactivate`,
      { method: "POST", body: JSON.stringify(body) },
    ),
};
