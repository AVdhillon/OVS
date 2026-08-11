import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AuthPage } from "./pages/auth-page";
import { DashboardLayout } from "./pages/dashboard-layout";
import { EventsView } from "./pages/events-view";
import { ManageAccountView } from "./pages/manage-account-view";
import { ManageOrganizationsView } from "./pages/manage-organizations-view";
import { IdentityWalletView } from "./pages/identity-wallet-view";
import { ManageEventsView } from "./pages/manage-events-view";
import { useAppContext } from "./context/app-context";

function PublicRoute() {
  const { loading, session } = useAppContext();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  // Session is populated on mount via a cookie-authenticated /auth/profile
  // call (see app-context.tsx) — the JWT itself is no longer readable from
  // JS, so this is the only way to know "is there a valid session".
  if (session) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function ProtectedRoute() {
  const { loading, session } = useAppContext();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  // Guard on session — ORG/GOV sessions have no `user` object but are still authenticated
  if (!session) return <Navigate to="/" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <PublicRoute />,
    children: [
      { index: true, element: <AuthPage /> },
    ],
  },
  {
    path: "/dashboard",
    element: <ProtectedRoute />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { index: true, element: <Navigate to="/dashboard/events" replace /> },
          { path: "events", element: <EventsView /> },
          { path: "manage-events", element: <ManageEventsView /> },
          { path: "organizations", element: <ManageOrganizationsView /> },
          { path: "identity-wallet", element: <IdentityWalletView /> },
          { path: "account", element: <ManageAccountView /> },
        ],
      },
    ],
  },
]);