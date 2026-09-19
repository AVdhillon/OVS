import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AdminLoginPage } from "./pages/admin-login-page";
import { AdminDashboardPage } from "./pages/admin-dashboard-page";
import { AdminRequestQueuePage } from "./pages/admin-request-queue-page";
import { AdminRequestDetailPage } from "./pages/admin-request-detail-page";
import { AdminOrgDirectoryPage } from "./pages/admin-org-directory-page";
import { AdminOrgDetailPage } from "./pages/admin-org-detail-page";
import { AdminAuditLogPage } from "./pages/admin-audit-log-page";
import { AdminAnalyticsPage } from "./pages/admin-analytics-page";
import { AdminAccountsPage } from "./pages/admin-accounts-page";
import { useAdminContext } from "./context/admin-context";

// EDIT (Phase 1 — auth model consolidation, subphase 1.10): mirrors
// app/routes.tsx's PublicRoute/ProtectedRoute pattern, keyed off the admin
// session (GET /auth/admin-profile via admin-context.tsx) instead of the
// regular UNIFIED/ORG session.

function PublicRoute() {
  const { loading, admin } = useAdminContext();
  if (loading)
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  if (admin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function ProtectedRoute() {
  const { loading, admin } = useAdminContext();
  if (loading)
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  if (!admin) return <Navigate to="/" replace />;
  return <Outlet />;
}

export const adminRouter = createBrowserRouter([
  {
    path: "/",
    element: <PublicRoute />,
    children: [{ index: true, element: <AdminLoginPage /> }],
  },
  {
    path: "/dashboard",
    element: <ProtectedRoute />,
    children: [{ index: true, element: <AdminDashboardPage /> }],
  },
  // EDIT (Phase 3 — admin portal core, subphase 3.5): request-queue +
  // request-detail pages, both gated behind the same admin-session
  // ProtectedRoute the dashboard already uses.
  {
    path: "/requests",
    element: <ProtectedRoute />,
    children: [
      { index: true, element: <AdminRequestQueuePage /> },
      { path: ":requestId", element: <AdminRequestDetailPage /> },
    ],
  },
  // EDIT (Phase 3 — admin portal core, subphase 3.6): org-directory +
  // org-detail pages, same ProtectedRoute gating as /requests above.
  {
    path: "/organizations",
    element: <ProtectedRoute />,
    children: [
      { index: true, element: <AdminOrgDirectoryPage /> },
      { path: ":orgid", element: <AdminOrgDetailPage /> },
    ],
  },
  // EDIT (Phase 5 — platform maturity, subphase 5.1): the audit-log viewer.
  // A single route, not an index/detail pair like the two above — the page
  // keeps its filter and its per-org scope in the query string instead
  // (see its own header comment), so /audit?target_type=ORGANIZATION&
  // target_id=ABC1234 is the per-org view rather than a separate path.
  {
    path: "/audit",
    element: <ProtectedRoute />,
    children: [{ index: true, element: <AdminAuditLogPage /> }],
  },
  // EDIT (Phase 5 — platform maturity, subphase 5.2): the platform
  // analytics dashboard. Single route with no parameters — the page keeps
  // its metric/interval selection in local state rather than the URL,
  // unlike 5.1's audit viewer: a chart selection isn't something anyone
  // pastes into a ticket the way a filtered audit view is.
  {
    path: "/analytics",
    element: <ProtectedRoute />,
    children: [{ index: true, element: <AdminAnalyticsPage /> }],
  },
  // EDIT (Phase 5 — platform maturity, subphase 5.3): admin account
  // management. Same ProtectedRoute (any signed-in admin) as every route
  // above — the super-admin restriction is enforced by the page itself
  // (a notice card for a non-super session, per its own header comment)
  // and, authoritatively, by AdminAccountsController's
  // @RequireSuperAdmin() on the backend; ProtectedRoute here only checks
  // that an admin session exists at all, same as /audit and /analytics.
  {
    path: "/admins",
    element: <ProtectedRoute />,
    children: [{ index: true, element: <AdminAccountsPage /> }],
  },
]);
