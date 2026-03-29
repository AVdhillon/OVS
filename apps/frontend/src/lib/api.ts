const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
import { UpdateMeResponse } from '../types/users';

export function setToken(t: string | null) {
  t ? localStorage.setItem('ovp_token', t) : localStorage.removeItem('ovp_token');
}
export function getToken() { return localStorage.getItem('ovp_token'); }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // ── Auth ────────────────────────────────────────────────────────────────────
  sendOtp: (identifier: string) =>
    request('/auth/send-otp', { method: 'POST', body: JSON.stringify({ identifier }) }),
  login: (body: object) =>
    request<{ access_token: string }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getProfile: () => request('/auth/profile'),

  // ── Users ───────────────────────────────────────────────────────────────────
  register: (body: object) =>
    request('/users/register', { method: 'POST', body: JSON.stringify(body) }),
  getMe: () => request('/users/me'),
  updateMe: (body: object) =>
    request<UpdateMeResponse>('/users/me', { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Events ──────────────────────────────────────────────────────────────────
  getEvents: () => request('/events'),
  getEvent: (id: number) => request(`/events/${id}`),
  createEvent: (body: object) =>
    request('/events', { method: 'POST', body: JSON.stringify(body) }),
  getResults: (id: number) => request(`/events/${id}/results`),

  // ── Voting ──────────────────────────────────────────────────────────────────
  castVote: (body: object) =>
    request('/voting/cast', { method: 'POST', body: JSON.stringify(body) }),

  // ── Org ─────────────────────────────────────────────────────────────────────
  // No uid needed — no RolesGuard on these two
  getMyOrgs: () => request('/org/mine'),
  registerOrg: (body: object) =>
    request('/org/register', { method: 'POST', body: JSON.stringify(body) }),

  // All routes below are @RequireOrganizer — uid must be in query string
  // so the RolesGuard can resolve it for UNIFIED sessions.

  getMembers: (orgid: string, uid: string, params?: Record<string, string>) => {
    const q = new URLSearchParams({ uid, ...params }).toString();
    return request(`/org/${orgid}/members?${q}`);
  },

  addMembers: (orgid: string, uid: string, body: object) =>
    request(`/org/${orgid}/members?uid=${uid}`, { method: 'POST', body: JSON.stringify(body) }),

  updateMember: (orgid: string, uid: string, targetUid: string, body: object) =>
    request(`/org/${orgid}/members/${targetUid}?uid=${uid}`, { method: 'PATCH', body: JSON.stringify(body) }),

  removeMember: (orgid: string, uid: string, targetUid: string) =>
    request(`/org/${orgid}/members/${targetUid}?uid=${uid}`, { method: 'DELETE' }),

  getScopeTree: (orgid: string, uid: string) =>
    request(`/org/${orgid}/scope?uid=${uid}`),

  createScope: (orgid: string, uid: string, body: object) =>
    request(`/org/${orgid}/scope?uid=${uid}`, { method: 'POST', body: JSON.stringify(body) }),

  updateScope: (orgid: string, uid: string, scopeId: number, body: object) =>
    request(`/org/${orgid}/scope/${scopeId}?uid=${uid}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteScope: (orgid: string, uid: string, scopeId: number) =>
    request(`/org/${orgid}/scope/${scopeId}?uid=${uid}`, { method: 'DELETE' }),

  // ── Identity ────────────────────────────────────────────────────────────────
  getWallet: () => request('/identity/getwallet'),
  addIdentity: (body: object) =>
    request('/identity/wallet/add', { method: 'POST', body: JSON.stringify(body) }),
};