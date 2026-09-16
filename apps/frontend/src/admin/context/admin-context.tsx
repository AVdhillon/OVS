import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { adminApi, type AdminProfile } from "../lib/admin-api";

// EDIT (Phase 1 — auth model consolidation, subphase 1.10): minimal context
// for the standalone admin app — deliberately much smaller than
// app-context.tsx. There's no user/wallet/orgs/events state here because
// none of that belongs to a SITEADMIN session; this just tracks whether
// there's a valid admin session and who it belongs to. Org-request-queue
// and org-directory state (Phase 3) will likely get their own
// page-level/context state once those pages exist — not pre-built here.

interface AdminContextType {
  admin: AdminProfile | null;
  setAdmin: (a: AdminProfile | null) => void;
  loading: boolean;
  logout: () => Promise<void>;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

export const useAdminContext = () => {
  const ctx = useContext(AdminContext);
  if (!ctx)
    throw new Error("useAdminContext must be used within AdminProvider");
  return ctx;
};

export const AdminProvider = ({ children }: { children: ReactNode }) => {
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: same pattern as app-context.tsx's boot effect — the JWT lives
  // in the httpOnly ovp_admin_token cookie, so ask the backend who it
  // belongs to via GET /auth/admin-profile rather than decoding anything
  // client-side. A 401 here just means "not logged in as an admin".
  useEffect(() => {
    let cancelled = false;

    void adminApi.hydrateAdminCsrfToken();

    adminApi
      .getAdminProfile({ silent401: true })
      .then((profile) => {
        if (cancelled) return;
        setAdmin(profile);
      })
      .catch(() => {
        if (!cancelled) setAdmin(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const logout = async () => {
    try {
      await adminApi.adminLogout();
    } catch {
      /* best-effort */
    }
    setAdmin(null);
  };

  return (
    <AdminContext.Provider value={{ admin, setAdmin, loading, logout }}>
      {children}
    </AdminContext.Provider>
  );
};
