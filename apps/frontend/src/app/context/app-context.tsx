import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { api } from "../../lib/api";

// ─── Identity / Session types ─────────────────────────────────────────────────

// Mirrors the backend's JwtUser type. Note this app's own GET /auth/profile
// call can in practice only ever resolve to UNIFIED or ORG — SITEADMIN
// sessions live on the separate ovp_admin_token cookie, read by the
// standalone admin app, never by this app's JwtStrategy. SITEADMIN is
// included in the union anyway so this type stays a complete, accurate
// mirror of the JWT payload shape rather than one that's silently wrong
// the moment anything shares it.
export type SessionType = "UNIFIED" | "ORG" | "SITEADMIN";

/** Mirrors JWT payload. pid is string (BigInt serialised). */
export interface Session {
  type: SessionType;
  pid?: string; // UNIFIED + ORG (when linked)
  orgid?: string; // ORG
  uid?: string; // ORG
  admin_id?: string; // SITEADMIN
  is_super_admin?: boolean; // SITEADMIN
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

// Matches the backend's identity_wallet.chk_identity_type CHECK constraint
// and AddIdentityDto — wallet entries are ORG-only.
export interface WalletIdentity {
  identity_type: "ORG";
  identity_id: string; // orgid
  uid?: string; // present for ORG entries
}

// ─── Organization ─────────────────────────────────────────────────────────────

export interface OrgSummary {
  orgid: string;
  org_name: string;
  org_email?: string;
  is_active: boolean;
  created_at: string;
  uid: string; // caller's uid in this org
  // Returned with the org list so the org admin dashboard can show
  // "current limit + usage" without a second round trip — see
  // OrgService.getMyOrgs().
  member_limit: number;
  member_count: number;
  // True only when the caller organizes the root scope; gates the
  // member-limit UI.
  is_root_organizer?: boolean;
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
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
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

const emptyEvents: EventsListing = {
  active_pending: [],
  voted: [],
  completed: [],
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useAppContext = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
};

// ─── Provider ─────────────────────────────────────────────────────────────────

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [wallet, setWallet] = useState<WalletIdentity[]>([]);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [events, setEvents] = useState<EventsListing>(emptyEvents);
  const [loading, setLoading] = useState(true);

  // On mount: the JWT lives in an httpOnly cookie now, so JS can't read or
  // decode it directly. Instead, ask the backend who the cookie belongs to
  // — GET /auth/profile is guarded by AuthGuard('jwt') and returns the
  // token payload plus session_id. A 401
  // here (no cookie, or an invalid/expired one) just means "not logged in".
  useEffect(() => {
    let cancelled = false;

    // Fire alongside the profile probe rather than after it — both share
    // the same "is there a valid session cookie" precondition, so there's
    // no ordering dependency. Both are awaited together below (Promise.all)
    // rather than firing hydrateCsrfToken() with `void` and letting it race
    // against setLoading(false): a fire-and-forget call let the UI go
    // interactive as soon as getProfile() resolved, before the separate
    // GET /auth/csrf-token round trip (only needed on a fresh tab/cleared
    // sessionStorage — see hydrateCsrfToken()'s own comment) had finished.
    // On a slow connection a user could reach Create Event and submit
    // before csrfTokenMemory was populated, so the very first mutating
    // request went out with no X-CSRF-Token header and CsrfGuard rejected
    // it with "Invalid or missing CSRF token" — even though the session
    // itself was perfectly valid.
    const csrfReady = api.hydrateCsrfToken().catch(() => {
      // No valid session to hydrate against — getProfile's own .catch()
      // below handles that outcome; nothing further to do here.
    });

    const profileReady = (api.getProfile({ silent401: true }) as Promise<any>)
      .then((raw) => {
        if (cancelled) return;
        const payload: Session = {
          type: raw.type,
          pid: raw.pid != null ? String(raw.pid) : undefined,
          orgid: raw.orgid,
          uid: raw.uid,
          admin_id: raw.admin_id,
          is_super_admin: raw.is_super_admin,
          session_id: raw.session_id,
        };
        setSession(payload);

        if (payload.type === "UNIFIED") {
          return (api.getMe() as Promise<any>).then((data) => {
            if (cancelled) return;
            setUser({
              pid: String(data.pid ?? ""),
              first_name: data.first_name,
              middle_name: data.middle_name,
              last_name: data.last_name,
              email: data.email,
              mobile: data.mobile,
              state: data.state,
              country: data.country,
            });
          });
        }
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });

    Promise.all([csrfReady, profileReady]).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);
  const updateEventInList = (
    eventId: number,
    updates: Partial<VotingEvent>,
  ) => {
    setEvents((prev) => {
      const patch = (arr: VotingEvent[]) =>
        arr.map((e) => (e.event_id === eventId ? { ...e, ...updates } : e));
      return {
        active_pending: patch(prev.active_pending),
        voted: patch(prev.voted),
        completed: patch(prev.completed),
      };
    });
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* best-effort */
    }
    setSession(null);
    setUser(null);
    setWallet([]);
    setOrgs([]);
    setEvents(emptyEvents);
  };

  return (
    <AppContext.Provider
      value={{
        session,
        setSession,
        user,
        setUser,
        wallet,
        setWallet,
        orgs,
        setOrgs,
        events,
        setEvents,
        updateEventInList,
        loading,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
