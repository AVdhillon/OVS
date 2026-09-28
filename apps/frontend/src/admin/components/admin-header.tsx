import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Button } from "../../app/components/ui/button";
import { useAdminContext } from "../context/admin-context";
import { ShieldCheck, LogOut, Menu, X } from "lucide-react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu whenever the route changes
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const items = NAV_ITEMS.filter(
    (item) => !item.superAdminOnly || admin?.is_super_admin,
  );

  const isItemActive = (path: string) =>
    path === "/dashboard"
      ? location.pathname === "/dashboard"
      : location.pathname.startsWith(path);

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 lg:gap-6">
          <Link
            to="/dashboard"
            className="flex shrink-0 items-center gap-2"
          >
            <ShieldCheck className="size-5 text-primary" />
            <span className="font-medium whitespace-nowrap">VoteCore Admin</span>
          </Link>
          {/* Desktop / large-tablet nav */}
          <nav className="hidden items-center gap-1 lg:flex">
            {items.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                  isItemActive(item.path)
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {admin && (
            <span className="hidden max-w-[10rem] truncate text-sm text-muted-foreground sm:inline">
              {admin.admin_id}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={logout}
            aria-label="Sign out"
            className="hidden sm:inline-flex"
          >
            <LogOut className="mr-1.5 size-4" />
            Sign out
          </Button>
          {/* Menu toggle below lg */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile / tablet dropdown panel */}
      {menuOpen && (
        <div className="border-t bg-background px-4 pb-4 pt-2 shadow-sm lg:hidden">
          <nav className="flex flex-col gap-1">
            {items.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "rounded-md px-3 py-2.5 text-sm transition-colors",
                  isItemActive(item.path)
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
            {admin && (
              <span className="min-w-0 truncate text-sm text-muted-foreground">
                {admin.admin_id}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="mr-1.5 size-4" />
              Sign out
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
