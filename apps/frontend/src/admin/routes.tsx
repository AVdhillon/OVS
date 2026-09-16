import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AdminLoginPage } from "./pages/admin-login-page";
import { AdminDashboardPage } from "./pages/admin-dashboard-page";
import { AdminRequestQueuePage } from "./pages/admin-request-queue-page";
import { AdminRequestDetailPage } from "./pages/admin-request-detail-page";
import { AdminOrgDirectoryPage } from "./pages/admin-org-directory-page";
import { AdminOrgDetailPage } from "./pages/admin-org-detail-page";
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
]);
