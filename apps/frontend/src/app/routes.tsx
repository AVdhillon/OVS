import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AuthPage } from "./pages/auth-page";
import { DashboardLayout } from "./pages/dashboard-layout";
import { EventsView } from "./pages/events-view";
import { ManageAccountView } from "./pages/manage-account-view";
import { ManageOrganizationsView } from "./pages/manage-organizations-view";
import { IdentityWalletView } from "./pages/identity-wallet-view";
import { ManageEventsView } from "./pages/manage-events-view";
import { useAppContext } from "./context/app-context";
import { getToken } from "../lib/api";

function PublicRoute() {
  const { loading } = useAppContext();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  // If a token exists the user is already authenticated (any session type)
  if (getToken()) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function ProtectedRoute() {
  const { loading } = useAppContext();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  // Guard on token — ORG/GOV sessions have no `user` object but are still authenticated
  if (!getToken()) return <Navigate to="/" replace />;
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