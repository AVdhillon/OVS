import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AdminLoginPage } from "./pages/admin-login-page";
import { AdminDashboardPage } from "./pages/admin-dashboard-page";
import { AdminRequestQueuePage } from "./pages/admin-request-queue-page";
import { AdminRequestDetailPage } from "./pages/admin-request-detail-page";
// The
// member-limit-request review screen — a separate component/route from
// AdminRequestDetailPage, per that page's own header comment.
import { AdminMemberLimitDetailPage } from "./pages/admin-member-limit-detail-page";
import { AdminStuckRequestsPage } from "./pages/admin-stuck-requests-page";
import { AdminOrgDirectoryPage } from "./pages/admin-org-directory-page";
import { AdminOrgDetailPage } from "./pages/admin-org-detail-page";
import { AdminAuditLogPage } from "./pages/admin-audit-log-page";
import { AdminAnalyticsPage } from "./pages/admin-analytics-page";
import { AdminAccountsPage } from "./pages/admin-accounts-page";
import { useAdminContext } from "./context/admin-context";

// Mirrors
// app/routes.tsx's PublicRoute/ProtectedRoute pattern, keyed off the admin
// session (GET /auth/admin-profile via admin-context.tsx) instead of the
// regular UNIFIED/ORG session.

function PublicRoute() {
  const { loading, admin } = useAdminContext();
  if (loading)
    return (
      <div className="flex h-dvh items-center justify-center text-muted-foreground">
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
      <div className="flex h-dvh items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  if (!admin) return <Navigate to="/" replace />;
  return <Outlet />;
}

export const adminRouter = createBrowserRouter(
  [
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
    // Request-queue +
    // request-detail pages, both gated behind the same admin-session
    // ProtectedRoute the dashboard already uses.
    {
      path: "/requests",
      element: <ProtectedRoute />,
      children: [
        { index: true, element: <AdminRequestQueuePage /> },
        // The
        // stuck-in-setup admin view. A static segment, so React Router's
        // own route ranking (static beats dynamic regardless of
        // declaration order) keeps it from ever being swallowed by
        // ":requestId" below — unlike the backend's Express-style ordering
        // concern on the equivalent GET route in
        // org-requests-admin.controller.ts, this isn't order-dependent,
        // but it's still listed first for readability.
        { path: "stuck", element: <AdminStuckRequestsPage /> },
        { path: ":requestId", element: <AdminRequestDetailPage /> },
      ],
    },
    // Its own
    // top-level path, not nested under /requests/:requestId — the unified
    // queue (AdminRequestQueuePage) already tells the two request kinds
    // apart by request_type before it ever navigates, and a shared
    // "/requests/:requestId" segment would need extra logic downstream just
    // to redisambiguate what a plain ":requestId" route can't on its own
    // (both tables' request_id sequences overlap, so a bare id doesn't say
    // which table it's from).
    {
      path: "/member-limit-requests",
      element: <ProtectedRoute />,
      children: [{ path: ":requestId", element: <AdminMemberLimitDetailPage /> }],
    },
    // Org-directory +
    // org-detail pages, same ProtectedRoute gating as /requests above.
    {
      path: "/organizations",
      element: <ProtectedRoute />,
      children: [
        { index: true, element: <AdminOrgDirectoryPage /> },
        { path: ":orgid", element: <AdminOrgDetailPage /> },
      ],
    },
    // The audit-log viewer.
    // A single route, not an index/detail pair like the two above — the page
    // keeps its filter and its per-org scope in the query string instead
    // (see its own header comment), so /audit?target_type=ORGANIZATION&
    // target_id=ABC1234 is the per-org view rather than a separate path.
    {
      path: "/audit",
      element: <ProtectedRoute />,
      children: [{ index: true, element: <AdminAuditLogPage /> }],
    },
    // The platform
    // analytics dashboard. Single route with no parameters — the page keeps
    // its metric/interval selection in local state rather than the URL,
    // unlike the audit viewer: a chart selection isn't something anyone
    // pastes into a ticket the way a filtered audit view is.
    {
      path: "/analytics",
      element: <ProtectedRoute />,
      children: [{ index: true, element: <AdminAnalyticsPage /> }],
    },
    // Admin account
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
  ],
  {
    // Every route above is written relative to "/" — but this app is
    // reached at /admin on the same origin as the main app (see
    // vercel.json's /admin + /admin/(.*) rewrite to admin.html, and
    // vite.config.ts's adminHtmlDevFallback plugin for the dev-server
    // equivalent), so the browser's actual visible pathname is always
    // "/admin" (or "/admin/<something>"), never bare "/". Without this
    // basename, createBrowserRouter matches routes against
    // window.location.pathname exactly, and the very first load
    // (pathname "/admin") matched nothing and fell into the default
    // "No routes matched" error boundary. /admin is the real path in both
    // dev and production, so this is a plain constant, not
    // import.meta.env.DEV-conditional.
    basename: "/admin",
  },
);
