const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function setToken(t: string | null) {
  t ? localStorage.setItem('ovp_token', t) : localStorage.removeItem('ovp_token');
}
export function getToken() { return localStorage.getItem('ovp_token'); }
const TOKEN_KEY = 'ovp_token';


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
  // Auth
  sendOtp: (identifier: string) =>
    request('/auth/send-otp', { method: 'POST', body: JSON.stringify({ identifier }) }),
  login: (body: object) =>
    request<{ access_token: string }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getProfile: () => request('/auth/profile'),

  // Users
  register: (body: object) =>
    request('/users/register', { method: 'POST', body: JSON.stringify(body) }),
  getMe: () => request('/users/me'),
  updateMe: (body: object) =>
    request('/users/me', { method: 'PATCH', body: JSON.stringify(body) }),

  // Events
  getEvents: () => request('/events'),
  getEvent: (id: number) => request(`/events/${id}`),
  createEvent: (body: object) =>
    request('/events', { method: 'POST', body: JSON.stringify(body) }),
  getResults: (id: number) => request(`/events/${id}/results`),

  // Voting
  castVote: (body: object) =>
    request('/voting/cast', { method: 'POST', body: JSON.stringify(body) }),

  // Org
  getMyOrgs: () => request('/org/mine'),
  registerOrg: (body: object) =>
    request('/org/register', { method: 'POST', body: JSON.stringify(body) }),
  getMembers: (orgid: string, params?: Record<string, string>) =>
    request(`/org/${orgid}/members?${new URLSearchParams(params)}`),
  addMembers: (orgid: string, body: object) =>
    request(`/org/${orgid}/members`, { method: 'POST', body: JSON.stringify(body) }),
  getScopeTree: (orgid: string, callerUid: string) =>
    request(`/org/${orgid}/scope`, { headers: { 'x-caller-uid': callerUid } }),

  // Identity
  getWallet: () => request('/identity/getwallet'),
  addIdentity: (body: object) =>
    request('/identity/wallet/add', { method: 'POST', body: JSON.stringify(body) }),
};