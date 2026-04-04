import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getToken, setToken } from '../../lib/api';
import { api } from '../../lib/api';

// ─── Identity / Session types ─────────────────────────────────────────────────

export type SessionType = 'UNIFIED' | 'ORG' | 'GOV';

/** Mirrors JWT payload. pid is string (BigInt serialised). */
export interface Session {
  type: SessionType;
  pid?: string;      // UNIFIED + ORG (when linked)
  orgid?: string;    // ORG
  uid?: string;      // ORG
  epic_id?: string;  // GOV
  session_id: number;
}

// ─── User (UNIFIED account) ───────────────────────────────────────────────────

export interface User {
  pid: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  email?: string;
  mobile?: string;
  state?: string;
  country?: string;
}

// ─── Identity Wallet entry ────────────────────────────────────────────────────

export interface WalletIdentity {
  identity_type: 'ORG' | 'GOV';
  identity_id: string; // orgid or epic_id
  uid?: string;        // present for ORG entries
}

// ─── Organization ─────────────────────────────────────────────────────────────

export interface OrgSummary {
  orgid: string;
  org_name: string;
  org_email?: string;
  is_active: boolean;
  created_at: string;
  uid: string; // caller's uid in this org
}

export interface ScopeNode {
  scope_id: number;
  scope_name: string;
  parent_scope_id: number | null;
  children: ScopeNode[];
}

export interface OrgMember {
  uid: string;
  mobile?: string;
  email?: string;
  pid?: string;
  is_voter: boolean;
  is_organizer: boolean;
  scope_id?: number;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface Candidate {
  candidate_id: number;
  candidate_name: string;
  description?: string;
}

export interface VoteResult {
  candidate_id: number;
  candidate_name: string;
  vote_count: number;
  percentage: number;
}

export interface VotingEvent {
  event_id: number;
  orgid: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  show_live_results: boolean;
  visibility_upward: boolean;
  scope_only: boolean;
  scope_id?: number;
  has_voted: boolean;
  candidates?: Candidate[];
  is_voter: boolean;
  is_organizer: boolean;
  created_by_uid: string;
  results?: VoteResult[] | null;
  acting_uid?: string; // which uid the current user is acting as for this event
}

export interface EventsListing {
  active_pending: VotingEvent[];
  voted: VotingEvent[];
  completed: VotingEvent[];
}

// ─── Context shape ────────────────────────────────────────────────────────────

interface AppContextType {
  // Session
  session: Session | null;
  setSession: (s: Session | null) => void;

  // User (UNIFIED account profile)
  user: User | null;
  setUser: (u: User | null) => void;

  // Identity wallet
  wallet: WalletIdentity[];
  setWallet: (w: WalletIdentity[]) => void;

  // Orgs (where user is organizer)
  orgs: OrgSummary[];
  setOrgs: (o: OrgSummary[]) => void;

  // Events
  events: EventsListing;
  setEvents: (e: EventsListing) => void;
  updateEventInList: (eventId: number, updates: Partial<VotingEvent>) => void;

  // Loading
  loading: boolean;

  // Auth helpers
  logout: () => Promise<void>;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const emptyEvents: EventsListing = { active_pending: [], voted: [], completed: [] };

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useAppContext = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
};

// ─── Provider ─────────────────────────────────────────────────────────────────

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser]       = useState<User | null>(null);
  const [wallet, setWallet]   = useState<WalletIdentity[]>([]);
  const [orgs, setOrgs]       = useState<OrgSummary[]>([]);
  const [events, setEvents]   = useState<EventsListing>(emptyEvents);
  const [loading, setLoading] = useState(true);

  // On mount: if token exists, rehydrate user profile
  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }

    // Decode JWT payload — no library needed, JWT middle segment is base64url
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setSession({
        type:       payload.type,
        pid:        payload.pid != null ? String(payload.pid) : undefined,
        orgid:      payload.orgid,
        uid:        payload.uid,
        epic_id:    payload.epic_id,
        session_id: payload.session_id,
      });
    } catch {
      // Token is malformed — wipe it and stop
      setToken(null);
      setLoading(false);
      return;
    }
    let payload: Session;
    try {
      const raw = JSON.parse(atob(token.split('.')[1]));
      payload = {
        type:       raw.type,
        pid:        raw.pid != null ? String(raw.pid) : undefined,
        orgid:      raw.orgid,
        uid:        raw.uid,
        epic_id:    raw.epic_id,
        session_id: raw.session_id,
      };
      setSession(payload);
    } catch {
      setToken(null);
      setLoading(false);
      return;
    }
    if (payload.type === 'UNIFIED') {
      (api.getMe() as Promise<any>)
          .then(data => {
            setUser({
              pid: String(data.pid ?? ''),
              first_name: data.first_name,
              middle_name: data.middle_name,
              last_name: data.last_name,
              email: data.email,
              mobile: data.mobile,
              state: data.state,
              country: data.country,
            });
          })
          .catch(() => {
            setToken(null);
            setSession(null);   // ← also clear session if profile fetch fails
          })
          .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);
  const updateEventInList = (eventId: number, updates: Partial<VotingEvent>) => {
    setEvents(prev => {
      const patch = (arr: VotingEvent[]) =>
          arr.map(e => e.event_id === eventId ? { ...e, ...updates } : e);
      return {
        active_pending: patch(prev.active_pending),
        voted:          patch(prev.voted),
        completed:      patch(prev.completed),
      };
    });
  };

  const logout = async () => {
    try { await api.logout(); } catch { /* best-effort */ }
    setToken(null);
    setSession(null);
    setUser(null);
    setWallet([]);
    setOrgs([]);
    setEvents(emptyEvents);
  };

  return (
      <AppContext.Provider value={{
        session, setSession,
        user, setUser,
        wallet, setWallet,
        orgs, setOrgs,
        events, setEvents, updateEventInList,
        loading,
        logout,
      }}>
        {children}
      </AppContext.Provider>
  );
};