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
    window.location.href = "/";
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

export type OrgRequestStatus =
  | "PENDING"
  | "NEEDS_INFO"
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

  /** No request body — approve() takes no reviewer-supplied text (see the controller). */
  approveOrgRequest: (requestId: string) =>
    request<{
      request_id: string;
      orgid: string;
      org_name: string;
      root_scope_id: number;
      owner_uid: string;
      message: string;
    }>(`/admin/org-requests/${encodeURIComponent(requestId)}/approve`, {
      method: "POST",
    }),

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
};

