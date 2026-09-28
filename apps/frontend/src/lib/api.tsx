import { toast } from "sonner";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
import type {
  User,
  OrgSummary,
  OrgMember,
  ScopeNode,
  VotingEvent,
  EventsListing,
  WalletIdentity,
} from "../app/context/app-context";
import { UpdateMeResponse } from "../types/users";
import { normalizeEvent } from "../utils/normalizeEvent";

// ── Response types ────────────────────────────────────────────────────────────

// Shape of GET /org/self
// (org.controller.ts::getOrgSelfInfo) — the organizer-free counterpart to
// OrgSummary, since a plain (non-organizer) ORG member's Account tab has no
// use for the organizer-only fields (is_active, member_limit, etc.).
export interface OrgSelfInfo {
  orgid: string;
  org_name: string;
  org_email?: string;
  uid: string;
}

export interface EventResults {
  event_id: number;
  title: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  total_votes: number;
  results: {
    candidate_id: number;
    candidate_name: string;
    vote_count: number;
    percentage: number;
  }[];
}

export interface EventParticipant {
  uid: string;
  orgid: string;
  has_voted: boolean;
  mobile?: string;
  email?: string;
}

export interface CastVoteResponse {
  message: string;
  vote: {
    vote_id: number;
    event_id: number;
    candidate_id: number;
    voted_at: string;
    voter_hash: string;
  };
  live_results?: EventResults["results"];
}

// Submitting a request does not create an organization on the spot — it
// creates an org_requests row that a site admin reviews, so the response
// carries a tracking reference + status instead of an orgid.
// Field shapes mirror OrgRequestsService.submit()'s actual return object
// (request_id/pid-style bigints are stringified by the backend's global
// BigIntInterceptor, same as everywhere else in this file).
export interface OrgRequestSubmitResponse {
  request_id: string;
  reference_code: string;
  org_name: string;
  status: "PENDING" | "NEEDS_INFO" | "APPROVED" | "REJECTED";
  created_at: string;
  message: string;
}

// The "My requests" view's list-item
// shape — GET /org/request/mine's response. A narrower projection than the
// admin-facing shapes elsewhere in this file (no verification-signal
// columns — those are reviewer-only context, per OrgRequestsService.listMine()'s
// own comment) but not narrower than OrgRequestSubmitResponse: unlike a fresh
// submission's response, a listed request may be REJECTED/NEEDS_INFO, so this
// carries review_note/reviewed_at/approved_orgid too.
//
// Status
// widened to include 'APPROVED_PENDING_SETUP' (the schema change) and
// admin_set_member_limit added — listMine() (org-requests.service.ts) now
// selects it too, needed for the finalize-setup wizard's read-only review
// step. null for every status this side of an admin's approve() call.
export interface OrgRequestMine {
  request_id: string;
  reference_code: string;
  org_name: string;
  org_email: string | null;
  expected_member_count: number | null;
  justification: string | null;
  status:
    | "PENDING"
    | "NEEDS_INFO"
    | "APPROVED_PENDING_SETUP"
    | "APPROVED"
    | "REJECTED";
  review_note: string | null;
  reviewed_at: string | null;
  approved_orgid: string | null;
  admin_set_member_limit: number | null;
  created_at: string;
  updated_at: string;
}

// Input for
// POST /org/request/:requestId/finalize — mirrors FinalizeOrgRequestDto
// (finalize-org-request.dto.ts) field-for-field.
export interface FinalizeOrgRequestBody {
  orgid_choice: { mode: "preferred"; orgid: string } | { mode: "generate" };
  org_email: string;
  org_email_otp?: string;
  owner_uid: string;
}

// Response shape of OrgRequestsService.finalizeSetup() — same
// { orgid, root_scope_id, ... } shape the old registerOrg() endpoint used
// to return (see that method's own comment), now on the finalize route.
export interface FinalizeOrgRequestResponse {
  request_id: string;
  status: "APPROVED";
  reference_code: string;
  org_name: string;
  orgid: string;
  root_scope_id: number;
  message: string;
}

export interface OrgIdAvailabilityResponse {
  orgid: string;
  available: boolean;
}

// ── Member limit increase requests  ───────────────────────────────────────────────────
// Types mirror OrgLimitRequestsService's plain-object return
// shapes. Deliberately their own interfaces rather than reusing
// OrgRequestSubmitResponse/OrgRequestMine — org_member_limit_requests has no
// reference_code/expected_member_count/approved_orgid, and carries
// current_limit/requested_limit, which org_requests has no equivalent of.

export type MemberLimitRequestStatus =
  | "PENDING"
  | "NEEDS_INFO"
  | "APPROVED"
  | "REJECTED";

/** POST /org/:orgid/member-limit-requests — OrgLimitRequestsService.submit()'s shape. */
export interface MemberLimitRequestSubmitResponse {
  request_id: string;
  orgid: string;
  requested_by_uid: string;
  current_limit: number;
  requested_limit: number;
  justification: string | null;
  status: MemberLimitRequestStatus;
  created_at: string;
  message: string;
}

/**
 * GET /org/:orgid/member-limit-requests — one row of this org's own history,
 * newest first. OrgLimitRequestsService.listForOrg() returns the full row
 * (unlike list()'s narrower admin-queue projection), so this carries
 * review_note/reviewed_at too — an organizer whose request came back
 * NEEDS_INFO needs to see what the admin actually wrote.
 */
export interface MemberLimitRequestRow {
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
}

export interface AddMembersResponse {
  results: {
    uid: string;
    status: "added" | "reactivated" | "role_assigned" | "skipped" | "error";
    error?: string;
  }[];
}

/**
 * A single scope assignment row from member_roles.
 * One member can have many of these — one per scope they're assigned to.
 */
export interface MemberRole {
  scope_id: number;
  is_voter: boolean;
  is_organizer: boolean;
}

// OrgMember returned by getMembers always includes a `roles` array.
// The app-context OrgMember type predates the multi-scope roles design;
// this intersection extends it without changing the context type globally.
export type OrgMemberWithRoles = OrgMember & { roles: MemberRole[] };

// ── CSRF helper ────────────────────────────────────────────────────────────────
// Was reading the ovp_csrf cookie via document.cookie. That only works
// when frontend and backend share a registrable domain the cookie can be
// scoped to. When they're deployed on unrelated hosts (e.g. two separate
// *.azurewebsites.net apps, which is a public suffix — cookies can't be
// scoped broader than the exact app hostname), frontend JS can never read a
// cookie the backend set for its own origin, even though the browser still
// sends it back to the backend automatically. That silently broke every
// mutating request in that deployment shape ("Invalid or missing CSRF
// token" on every POST/PATCH/DELETE).
//
// Fix: the backend now also returns the CSRF value directly in the login
// response body (see auth.controller.ts). We keep it in memory here, and
// mirror it into sessionStorage so it survives a page reload within the
// same tab without needing another round trip. A fresh tab (no
// sessionStorage entry) but still-valid session cookie rehydrates it via
// GET /auth/csrf-token — see hydrateCsrfToken() below, called at app boot.
const CSRF_STORAGE_KEY = "ovp_csrf_token";
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
// `silent401`: skip the global redirect-to-`/` on a 401 and just reject
// instead. Needed for the boot-time "am I logged in" probe (getProfile,
// called unconditionally now that there's no localStorage token to check
// first) — an unauthenticated visitor hitting that probe is an expected
// outcome, not a session that just expired mid-use.
async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: { silent401?: boolean } = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const csrfToken = getCsrfToken();

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include", // send the httpOnly ovp_token cookie
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
    // Cookie is either absent or was already cleared/expired server-side;
    // there's nothing left in JS to clean up (no more localStorage token).
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
// SITEADMIN is deliberately NOT included here: site-admin login is a wholly
// separate flow served by the standalone admin app against
// POST /auth/admin-login, not this app's POST /auth/login — mirrors the
// backend split, where SiteAdminLoginDto is its own class, not a third arm
// of LoginDto's union.
export type LoginType = "UNIFIED" | "ORG";

export interface UnifiedLoginBody {
  type: "UNIFIED";
  identifier: string;
  otp?: string;
}
export interface OrgLoginBody {
  type: "ORG";
  orgid: string;
  uid: string;
  otp?: string;
}
export type LoginBody = UnifiedLoginBody | OrgLoginBody;

// ── API ───────────────────────────────────────────────────────────────────────
export const api = {
  // ── Auth ───────────────────────────────────────────────────────────────────

  sendOtp: (identifier: string) =>
    request("/auth/send-otp", {
      method: "POST",
      body: JSON.stringify({ identifier }),
    }),

  sendLoginOtp: (body: Omit<LoginBody, "otp">) =>
    request("/auth/send-login-otp", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  verifyOtp: (identifier: string, otp: string) =>
    request("/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({ identifier, otp }),
    }),

  login: async (body: LoginBody) => {
    const res = await request<{ message: string; csrf_token: string }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify(body) },
    );
    setCsrfToken(res.csrf_token);
    return res;
  },

  logout: async () => {
    const res = await request("/auth/logout", { method: "POST" });
    setCsrfToken(null);
    return res;
  },

  // Rehydrates the CSRF token from a still-valid session cookie when we
  // don't have one in memory/sessionStorage yet — e.g. a fresh tab, or a
  // browser that cleared sessionStorage on reload. Call at app boot
  // alongside getProfile(). Safe to call speculatively: a 401 here just
  // means there's no session, which the getProfile probe already handles.
  hydrateCsrfToken: async () => {
    if (getCsrfToken()) return; // already have one, no round trip needed
    try {
      const res = await request<{ csrf_token: string }>(
        "/auth/csrf-token",
        {},
        { silent401: true },
      );
      setCsrfToken(res.csrf_token);
    } catch {
      // no valid session — nothing to hydrate, getProfile's own probe
      // will handle redirecting/gating the UI
    }
  },

  getProfile: (opts?: { silent401?: boolean }) =>
    request<User>("/auth/profile", {}, opts),

  // ── Users ──────────────────────────────────────────────────────────────────

  register: (body: {
    first_name: string;
    last_name: string;
    otp: string;
    middle_name?: string;
    mobile?: string;
    email?: string;
    country?: string;
    state?: string;
  }) =>
    request<User>("/users/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getMe: () => request<User>("/users/me"),

  updateMe: (body: {
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    mobile?: string;
    mobile_otp?: string;
    email?: string;
    email_otp?: string;
    country?: string;
    state?: string;
  }) =>
    request<UpdateMeResponse>("/users/me", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // ── Events ─────────────────────────────────────────────────────────────────

  getEvents: async () => {
    const data = await request<EventsListing>("/events");
    return {
      active_pending: data.active_pending.map(normalizeEvent),
      voted: data.voted.map(normalizeEvent),
      completed: data.completed.map(normalizeEvent),
    };
  },

  getEvent: async (id: number) => {
    const data = await request<VotingEvent>(`/events/${id}`);
    return normalizeEvent(data);
  },

  createEvent: (body: {
    orgid: string;
    uid: string;
    // Optional — omit or send null to default to the org's ROOT scope
    // (see the "Scope (defaults to org root)" copy in CreateEventForm and
    // EventsService.createEvent()'s resolution of this default).
    scope_id?: number | null;
    title: string;
    start_time: string;
    end_time: string;
    candidates: { candidate_name: string; description?: string }[];
    description?: string;
    show_live_results?: boolean;
    visible_upward?: boolean;
    scope_only?: boolean;
  }) =>
    request<VotingEvent>("/events", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateEvent: (
    orgId: string,
    eventId: number,
    actingUid: string,
    body: {
      title?: string;
      description?: string;
      start_time?: string;
      end_time?: string;
      show_live_results?: boolean;
      visible_upward?: boolean;
      scope_only?: boolean;
    },
  ) =>
    request(`/events/${orgId}/${eventId}/${actingUid}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteEvent: (id: number) => request(`/events/${id}`, { method: "DELETE" }),

  getResults: (id: number) => request<EventResults>(`/events/${id}/results`),

  getParticipants: (eventId: number) =>
    request<{ event_id: number; participants: EventParticipant[] }>(
      `/events/${eventId}/participants`,
    ),

  // ── Candidates ─────────────────────────────────────────────────────────────

  addCandidate: (
    eventId: number,
    body: { candidate_name: string; description?: string },
  ) =>
    request(`/events/${eventId}/candidates`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateCandidate: (
    eventId: number,
    candidateId: number,
    body: { candidate_name: string; description?: string },
  ) =>
    request(`/events/${eventId}/candidates/${candidateId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  removeCandidate: (eventId: number, candidateId: number) =>
    request(`/events/${eventId}/candidates/${candidateId}`, {
      method: "DELETE",
    }),

  // ── Voting ─────────────────────────────────────────────────────────────────

  castVote: (body: {
    event_id: number;
    candidate_id: number;
    device_fingerprint?: string;
  }) =>
    request<CastVoteResponse>("/voting/cast", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Org ────────────────────────────────────────────────────────────────────

  getMyOrgs: () => request<OrgSummary[]>("/org/mine"),

  // Organizer-free — any ORG session can read its own org's name/contact
  // and its own uid. See GET /org/self.
  getOrgSelfInfo: () => request<OrgSelfInfo>("/org/self"),

  // Org creation goes through the request/approve flow; the old direct
  // POST /org/register route no longer exists.
  //
  // submitOrgRequest() takes no caller_uid/caller_identifier/participants —
  // SubmitOrgRequestDto (backend) has none of those, since submitting
  // a request creates nothing yet for the caller to be a member of; that
  // binding happens on approval, not here.
  submitOrgRequest: (body: {
    org_name: string;
    org_email?: string;
    org_email_otp?: string;
    expected_member_count?: number;
    justification?: string;
  }) =>
    request<OrgRequestSubmitResponse>("/org/request", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Sends a one-time code to org_email to prove control of it before
  // submitOrgRequest() will accept a request referencing that address —
  // call this first when org_email is supplied, then pass the code back as
  // org_email_otp above. Mirrors sendOtp()'s response shape (an `otp` field
  // is present only in non-production dev-OTP builds, same as sendOtp()).
  sendOrgDomainOtp: (org_email: string) =>
    request<{ message: string; otp?: string }>("/org/request/send-domain-otp", {
      method: "POST",
      body: JSON.stringify({ org_email }),
    }),

  // The "My requests" view's two
  // calls — listing this account's own requests, and the edit-and-resubmit
  // action for one that's come back NEEDS_INFO. resubmitOrgRequest() takes
  // the same body shape as submitOrgRequest() (mirrors
  // SubmitOrgRequestDto/OrgRequestsService.resubmit() on the backend).
  listMyOrgRequests: () => request<OrgRequestMine[]>("/org/request/mine"),

  resubmitOrgRequest: (
    requestId: string,
    body: {
      org_name: string;
      org_email?: string;
      org_email_otp?: string;
      expected_member_count?: number;
      justification?: string;
    },
  ) =>
    request<OrgRequestSubmitResponse>(`/org/request/${requestId}/resubmit`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // The finalize-setup wizard's two calls — a live, read-only "is this orgid
  // free" check as the requester types their own choice (org.controller.ts's
  // GET /org/orgid-available, a thin wrapper — see that route's comment),
  // and the actual finalize submission (OrgRequestsService.finalizeSetup()).
  // Both use the singular '/org/request/...' path convention; the singular
  // form is deliberate, not a typo.
  checkOrgIdAvailable: (orgid: string) =>
    request<OrgIdAvailabilityResponse>(
      `/org/orgid-available?orgid=${encodeURIComponent(orgid)}`,
    ),

  finalizeOrgRequest: (requestId: string, body: FinalizeOrgRequestBody) =>
    request<FinalizeOrgRequestResponse>(`/org/request/${requestId}/finalize`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // The org
  // admin dashboard's "Request increase" action and its own request
  // history. Both organizer-only server-side (org.controller.ts's
  // @RequireOrganizer('orgid')) — `uid` is passed as a query param, same
  // convention as getMembers()/addMembers() below, for RolesGuard to resolve
  // and verify rather than trust blindly.
  submitLimitRequest: (
    orgid: string,
    uid: string,
    body: { requested_limit: number; justification?: string },
  ) =>
    request<MemberLimitRequestSubmitResponse>(
      `/org/${orgid}/member-limit-requests?uid=${encodeURIComponent(uid)}`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  listLimitRequestsForOrg: (orgid: string, uid: string) =>
    request<MemberLimitRequestRow[]>(
      `/org/${orgid}/member-limit-requests?uid=${encodeURIComponent(uid)}`,
    ),

  // Edits and resends a request that's in NEEDS_INFO — backs the
  // "Edit & resend" action MemberLimitTab shows in place of a disabled
  // "Request increase" button once the open request needs more info.
  resubmitLimitRequest: (
    orgid: string,
    uid: string,
    requestId: string,
    body: { requested_limit: number; justification?: string },
  ) =>
    request<MemberLimitRequestSubmitResponse>(
      `/org/${orgid}/member-limit-requests/${requestId}?uid=${encodeURIComponent(uid)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  // ── Org Members ────────────────────────────────────────────────────────────

  /**
   * Returns members. Each member has a `roles` array — one entry per scope assignment.
   * Return type now correctly reflects the `roles` field the backend always sends.
   */
  getMembers: (
    orgid: string,
    uid: string,
    params?: {
      role?: "organizer" | "voter";
      scope_id?: number;
      search?: string;
    },
  ) => {
    const q = new URLSearchParams({ uid });
    if (params?.role !== undefined) q.set("role", params.role);
    if (params?.scope_id !== undefined)
      q.set("scope_id", String(params.scope_id));
    if (params?.search !== undefined) q.set("search", params.search);
    return request<OrgMemberWithRoles[]>(
      `/org/${orgid}/members?${q.toString()}`,
    );
  },

  /**
   * Add members. Each participant gets one role row at the given scope_id.
   * For members that already exist, upserts a role row at the target scope.
   */
  addMembers: (
    orgid: string,
    uid: string,
    body: {
      participants?: {
        uid: string;
        participant_identifier?: string;
        role?: "v" | "vo" | "o" | "none";
      }[];
      participants_csv?: string;
      scope_id?: number;
    },
  ) =>
    request<AddMembersResponse>(`/org/${orgid}/members?uid=${uid}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * Update is_voter / is_organizer on one specific scope assignment row.
   * scope_id is required — it identifies which member_roles row to update.
   * To change which scope a member is assigned to, use moveMemberRole instead.
   */
  updateMember: (
    orgid: string,
    uid: string,
    targetUid: string,
    body: {
      scope_id: number; // identifies the row (part of composite PK)
      is_voter?: boolean;
      is_organizer?: boolean;
    },
  ) =>
    request(`/org/${orgid}/members/${targetUid}?uid=${uid}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * Soft-deletes the entire org_members row for targetUid, removing all their scope assignments.
   * Use removeMemberRole to remove just one scope assignment while leaving others intact.
   */
  removeMember: (orgid: string, uid: string, targetUid: string) =>
    request(`/org/${orgid}/members/${targetUid}?uid=${uid}`, {
      method: "DELETE",
    }),

  // ── Member Roles (per-scope assignment CRUD) ───────────────────────────────

  /**
   * Add a new scope assignment to an existing member.
   * Does not affect the member's other scope assignments.
   */
  addMemberRole: (
    orgid: string,
    uid: string,
    targetUid: string,
    body: {
      scope_id: number;
      is_voter: boolean;
      is_organizer: boolean;
    },
  ) =>
    request<MemberRole>(`/org/${orgid}/members/${targetUid}/roles?uid=${uid}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * Remove one scope assignment from a member.
   * If this is their last assignment, the server will soft-delete org_members too.
   */
  removeMemberRole: (
    orgid: string,
    uid: string,
    targetUid: string,
    scopeId: number,
  ) =>
    request(`/org/${orgid}/members/${targetUid}/roles/${scopeId}?uid=${uid}`, {
      method: "DELETE",
    }),

  /**
   * Atomically move a member's assignment from one scope to another.
   * from_scope_id + to_scope_id are required.
   * Roles (is_voter / is_organizer) are carried over unless explicitly provided.
   */
  moveMemberRole: (
    orgid: string,
    uid: string,
    targetUid: string,
    body: {
      from_scope_id: number;
      to_scope_id: number;
      is_voter?: boolean;
      is_organizer?: boolean;
    },
  ) =>
    request<MemberRole>(
      `/org/${orgid}/members/${targetUid}/roles/move?uid=${uid}`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  // ── Org Scope ─────────────────────────────────────────────────────────────

  getScopeTree: (orgid: string, uid: string) =>
    request<ScopeNode[]>(`/org/${orgid}/scope?uid=${uid}`),

  createScope: (
    orgid: string,
    uid: string,
    body: { scope_name: string; parent_scope_id?: number },
  ) =>
    request(`/org/${orgid}/scope?uid=${uid}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateScope: (
    orgid: string,
    uid: string,
    scopeId: number,
    body: { scope_name: string },
  ) =>
    request(`/org/${orgid}/scope/${scopeId}?uid=${uid}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteScope: (orgid: string, uid: string, scopeId: number) =>
    request(`/org/${orgid}/scope/${scopeId}?uid=${uid}`, { method: "DELETE" }),

  // ── Identity Wallet ────────────────────────────────────────────────────────

  getWallet: () => request<WalletIdentity[]>("/identity/getwallet"),

  addIdentity: (body: {
    // Narrowed to 'ORG' only, matching the backend's AddIdentityDto and
    // identity_wallet's chk_identity_type CHECK constraint.
    identity_type: "ORG";
    identity_id: string;
    otp: string;
    identifier: string;
    uid?: string;
  }) =>
    request("/identity/wallet/add", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
