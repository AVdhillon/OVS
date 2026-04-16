import { toast } from 'sonner';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
import type {
    User,
    OrgSummary,
    OrgMember,
    ScopeNode,
    VotingEvent,
    EventsListing,
    WalletIdentity,
} from '../app/context/app-context';
import { UpdateMeResponse } from '../types/users';
import { normalizeEvent } from '../utils/normalizeEvent';

// ── Response types ────────────────────────────────────────────────────────────

export interface EventResults {
    event_id: number;
    title: string;
    status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
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
    live_results?: EventResults['results'];
}

export interface RegisterOrgResponse {
    orgid: string;
    org_name: string;
    root_scope_id: number;
    message: string;
}

export interface AddMembersResponse {
    results: {
        uid: string;
        status: 'added' | 'reactivated' | 'role_assigned' | 'skipped' | 'error';
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

// FIX: OrgMember returned by getMembers always includes a `roles` array.
// The app-context OrgMember type predates the multi-scope roles design;
// this intersection extends it without changing the context type globally.
export type OrgMemberWithRoles = OrgMember & { roles: MemberRole[] };

// ── Token helpers ─────────────────────────────────────────────────────────────
export function setToken(t: string | null) {
    t ? localStorage.setItem('ovp_token', t) : localStorage.removeItem('ovp_token');
}

export function getToken() {
    return localStorage.getItem('ovp_token');
}

// ── Base request ──────────────────────────────────────────────────────────────
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
            ...init.headers,
        },
    });

    if (res.status === 401) {
        setToken(null);
        window.location.href = '/';
        return new Promise(() => {});
    }

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `HTTP ${res.status}`);
    }

    const data: any = await res.json();

    if (data?.otp) {
        toast(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <strong>DEV OTP</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 16 }}>{data.otp}</span>
                    <button
                        onClick={() => { navigator.clipboard.writeText(data.otp); toast.success('Copied!'); }}
                        style={{ padding: '2px 8px', fontSize: 12, border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}
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
export type LoginType = 'UNIFIED' | 'ORG' | 'GOV';

export interface UnifiedLoginBody { type: 'UNIFIED'; identifier: string; otp?: string; }
export interface OrgLoginBody     { type: 'ORG'; orgid: string; uid: string; otp?: string; }
export interface GovLoginBody     { type: 'GOV'; epic_id: string; otp?: string; }
export type LoginBody = UnifiedLoginBody | OrgLoginBody | GovLoginBody;

// ── API ───────────────────────────────────────────────────────────────────────
export const api = {

    // ── Auth ───────────────────────────────────────────────────────────────────

    sendOtp: (identifier: string) =>
        request('/auth/send-otp', { method: 'POST', body: JSON.stringify({ identifier }) }),

    sendLoginOtp: (body: Omit<LoginBody, 'otp'>) =>
        request('/auth/send-login-otp', { method: 'POST', body: JSON.stringify(body) }),

    verifyOtp: (identifier: string, otp: string) =>
        request('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ identifier, otp }) }),

    login: (body: LoginBody) =>
        request<{ access_token: string }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

    logout: () => request('/auth/logout', { method: 'POST' }),

    getProfile: () => request<User>('/auth/profile'),

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
    }) => request<User>('/users/register', { method: 'POST', body: JSON.stringify(body) }),

    getMe: () => request<User>('/users/me'),

    updateMe: (body: {
        first_name?: string; middle_name?: string; last_name?: string;
        mobile?: string; mobile_otp?: string;
        email?: string;  email_otp?: string;
        country?: string; state?: string;
    }) => request<UpdateMeResponse>('/users/me', { method: 'PATCH', body: JSON.stringify(body) }),

    // ── Events ─────────────────────────────────────────────────────────────────

    getEvents: async () => {
        const data = await request<EventsListing>('/events');
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
        orgid: string; uid: string; scope_id: number;
        title: string; start_time: string; end_time: string;
        candidates: { candidate_name: string; description?: string }[];
        description?: string; show_live_results?: boolean;
        visible_upward?: boolean; scope_only?: boolean;
    }) => request<VotingEvent>('/events', { method: 'POST', body: JSON.stringify(body) }),

    updateEvent: (orgId: string, eventId: number, actingUid: string, body: {
        title?: string; description?: string;
        start_time?: string; end_time?: string;
        show_live_results?: boolean; visible_upward?: boolean; scope_only?: boolean;
    }) => request(`/events/${orgId}/${eventId}/${actingUid}`, { method: 'PATCH', body: JSON.stringify(body) }),

    deleteEvent: (id: number) => request(`/events/${id}`, { method: 'DELETE' }),

    getResults: (id: number) => request<EventResults>(`/events/${id}/results`),

    getParticipants: (eventId: number) =>
        request<{ event_id: number; participants: EventParticipant[] }>(`/events/${eventId}/participants`),

    // ── Candidates ─────────────────────────────────────────────────────────────

    addCandidate: (eventId: number, body: { candidate_name: string; description?: string }) =>
        request(`/events/${eventId}/candidates`, { method: 'POST', body: JSON.stringify(body) }),

    updateCandidate: (eventId: number, candidateId: number, body: { candidate_name: string; description?: string }) =>
        request(`/events/${eventId}/candidates/${candidateId}`, { method: 'PATCH', body: JSON.stringify(body) }),

    removeCandidate: (eventId: number, candidateId: number) =>
        request(`/events/${eventId}/candidates/${candidateId}`, { method: 'DELETE' }),

    // ── Voting ─────────────────────────────────────────────────────────────────

    castVote: (body: { event_id: number; candidate_id: number; device_fingerprint?: string }) =>
        request<CastVoteResponse>('/voting/cast', { method: 'POST', body: JSON.stringify(body) }),

    // ── Org ────────────────────────────────────────────────────────────────────

    getMyOrgs: () => request<OrgSummary[]>('/org/mine'),

    registerOrg: (body: {
        org_name: string; caller_uid: string; caller_identifier: string;
        org_email?: string; org_prefix?: string; org_suffix?: string;
        preferred_orgid?: string;
        participants?: { uid: string; participant_identifier?: string; role?: 'v' | 'vo' | 'o' | 'none' }[];
        participants_csv?: string;
    }) => request<RegisterOrgResponse>('/org/register', { method: 'POST', body: JSON.stringify(body) }),

    // ── Org Members ────────────────────────────────────────────────────────────

    /**
     * Returns members. Each member has a `roles` array — one entry per scope assignment.
     * FIX: return type now correctly reflects the `roles` field the backend always sends.
     */
    getMembers: (orgid: string, uid: string, params?: {
        role?: 'organizer' | 'voter';
        scope_id?: number;
        search?: string;
    }) => {
        const q = new URLSearchParams({ uid });
        if (params?.role !== undefined) q.set('role', params.role);
        if (params?.scope_id !== undefined) q.set('scope_id', String(params.scope_id));
        if (params?.search !== undefined) q.set('search', params.search);
        return request<OrgMemberWithRoles[]>(`/org/${orgid}/members?${q.toString()}`);
    },

    /**
     * Add members. Each participant gets one role row at the given scope_id.
     * For members that already exist, upserts a role row at the target scope.
     */
    addMembers: (orgid: string, uid: string, body: {
        participants?: { uid: string; participant_identifier?: string; role?: 'v' | 'vo' | 'o' | 'none' }[];
        participants_csv?: string;
        scope_id?: number;
    }) => request<AddMembersResponse>(`/org/${orgid}/members?uid=${uid}`, { method: 'POST', body: JSON.stringify(body) }),

    /**
     * Update is_voter / is_organizer on one specific scope assignment row.
     * scope_id is required — it identifies which member_roles row to update.
     * To change which scope a member is assigned to, use moveMemberRole instead.
     */
    updateMember: (orgid: string, uid: string, targetUid: string, body: {
        scope_id: number;       // identifies the row (part of composite PK)
        is_voter?: boolean;
        is_organizer?: boolean;
    }) => request(`/org/${orgid}/members/${targetUid}?uid=${uid}`, { method: 'PATCH', body: JSON.stringify(body) }),

    /**
     * Soft-deletes the entire org_members row for targetUid, removing all their scope assignments.
     * Use removeMemberRole to remove just one scope assignment while leaving others intact.
     */
    removeMember: (orgid: string, uid: string, targetUid: string) =>
        request(`/org/${orgid}/members/${targetUid}?uid=${uid}`, { method: 'DELETE' }),

    // ── Member Roles (per-scope assignment CRUD) ───────────────────────────────

    /**
     * Add a new scope assignment to an existing member.
     * Does not affect the member's other scope assignments.
     */
    addMemberRole: (orgid: string, uid: string, targetUid: string, body: {
        scope_id: number;
        is_voter: boolean;
        is_organizer: boolean;
    }) =>
        request<MemberRole>(
            `/org/${orgid}/members/${targetUid}/roles?uid=${uid}`,
            { method: 'POST', body: JSON.stringify(body) },
        ),

    /**
     * Remove one scope assignment from a member.
     * If this is their last assignment, the server will soft-delete org_members too.
     */
    removeMemberRole: (orgid: string, uid: string, targetUid: string, scopeId: number) =>
        request(
            `/org/${orgid}/members/${targetUid}/roles/${scopeId}?uid=${uid}`,
            { method: 'DELETE' },
        ),

    /**
     * Atomically move a member's assignment from one scope to another.
     * from_scope_id + to_scope_id are required.
     * Roles (is_voter / is_organizer) are carried over unless explicitly provided.
     */
    moveMemberRole: (orgid: string, uid: string, targetUid: string, body: {
        from_scope_id: number;
        to_scope_id: number;
        is_voter?: boolean;
        is_organizer?: boolean;
    }) =>
        request<MemberRole>(
            `/org/${orgid}/members/${targetUid}/roles/move?uid=${uid}`,
            { method: 'POST', body: JSON.stringify(body) },
        ),

    // ── Org Scope ─────────────────────────────────────────────────────────────

    getScopeTree: (orgid: string, uid: string) =>
        request<ScopeNode[]>(`/org/${orgid}/scope?uid=${uid}`),

    createScope: (orgid: string, uid: string, body: { scope_name: string; parent_scope_id?: number }) =>
        request(`/org/${orgid}/scope?uid=${uid}`, { method: 'POST', body: JSON.stringify(body) }),

    updateScope: (orgid: string, uid: string, scopeId: number, body: { scope_name: string }) =>
        request(`/org/${orgid}/scope/${scopeId}?uid=${uid}`, { method: 'PATCH', body: JSON.stringify(body) }),

    deleteScope: (orgid: string, uid: string, scopeId: number) =>
        request(`/org/${orgid}/scope/${scopeId}?uid=${uid}`, { method: 'DELETE' }),

    // ── Identity Wallet ────────────────────────────────────────────────────────

    getWallet: () => request<WalletIdentity[]>('/identity/getwallet'),

    addIdentity: (body: {
        identity_type: 'ORG' | 'GOV';
        identity_id: string;
        otp: string;
        identifier: string;
        uid?: string;
    }) => request('/identity/wallet/add', { method: 'POST', body: JSON.stringify(body) }),
};