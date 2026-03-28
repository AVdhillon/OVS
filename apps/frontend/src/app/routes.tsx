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
  const { user, loading } = useAppContext();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function ProtectedRoute() {
  const { user, loading } = useAppContext();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <PublicRoute />,
    children: [
      { index: true, element: <AuthPage /> }
    ],
  },
  {
    path: "/dashboard",
    element: <ProtectedRoute />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { index: true, element: <EventsView /> },
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