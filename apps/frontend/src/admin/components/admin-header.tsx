import { Link, useLocation } from "react-router";
import { Button } from "../../app/components/ui/button";
import { useAdminContext } from "../context/admin-context";
import { ShieldCheck, LogOut } from "lucide-react";
import { cn } from "../../app/components/ui/utils";

// Small, shared top bar for the admin app, pulled out once more than one
// admin page needed the same logo/nav/sign-out header — keeping that markup
// in one place avoids each page carrying its own copy that silently drifts
// from the others.
//
// Deliberately NOT a full sidebar/layout like the main app's
// dashboard-layout.tsx: the admin app has a small, fixed set of top-level
// sections (Dashboard, Org Requests, Organizations), so a simple top nav
// bar covers it without building out a heavier layout shell. If the nav
// grows substantially, this is the file to extend, not replace.
const NAV_ITEMS: Array<{
  path: string;
  label: string;
  superAdminOnly?: boolean;
}> = [
  { path: "/dashboard", label: "Dashboard" },
  { path: "/requests", label: "Org Requests" },
  { path: "/organizations", label: "Organizations" },
  { path: "/audit", label: "Audit Log" },
  // Past roughly five top-level sections, a heavier layout shell (sidebar)
  // may become worth it over this plain top nav.
  { path: "/analytics", label: "Analytics" },
  // Admin account management. `superAdminOnly: true` — filtered out of the rendered nav
  // below for an ordinary (non-super) admin session, since every route
  // behind this link 403s for them anyway (AdminAccountsController is
  // @RequireSuperAdmin()-gated end to end, unlike every other admin
  // surface listed here) — no point showing a link that always errors.
  { path: "/admins", label: "Admin Accounts", superAdminOnly: true },
];

export function AdminHeader() {
  const { admin, logout } = useAdminContext();
  const location = useLocation();

  return (
    <div className="flex items-center justify-between border-b bg-background px-6 py-3">
      <div className="flex items-center gap-6">
        <Link to="/dashboard" className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <span className="font-medium">VoteCore Admin</span>
        </Link>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.filter(
            (item) => !item.superAdminOnly || admin?.is_super_admin,
          ).map((item) => {
            const isActive =
              item.path === "/dashboard"
                ? location.pathname === "/dashboard"
                : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        {admin && (
          <span className="text-sm text-muted-foreground">
            {admin.admin_id}
          </span>
        )}
        <Button variant="outline" size="sm" onClick={logout}>
          <LogOut className="mr-1.5 size-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
