import { Link, useLocation } from "react-router";
import { Button } from "../../app/components/ui/button";
import { useAdminContext } from "../context/admin-context";
import { ShieldCheck, LogOut } from "lucide-react";
import { cn } from "../../app/components/ui/utils";

// EDIT (Phase 3 — admin portal core, subphase 3.5): new, small, shared top
// bar for the admin app. admin-dashboard-page.tsx (subphase 1.10) inlined
// its own logo/nav/sign-out header when it was the only page that existed;
// now that this subphase adds the request-queue and request-detail pages
// (and 3.6 is about to add an org-directory pair on top of those), three-
// plus pages would otherwise each carry their own copy of the same markup
// and silently drift. Pulled out here instead — dashboard-page.tsx is
// updated in this subphase to use it too (see its own EDIT comment).
//
// Deliberately NOT a full sidebar/layout like the main app's
// dashboard-layout.tsx: the admin app today has three top-level sections
// (Dashboard, Org Requests, Organizations), so a simple top nav bar still
// carries that without building out a heavier layout shell this subphase
// doesn't need. If 5.x grows the nav further, this is the file to extend,
// not replace.
//
// EDIT (Phase 3 — admin portal core, subphase 3.6): added the
// "Organizations" nav item for this subphase's new directory/detail pages.
const NAV_ITEMS = [
  { path: "/dashboard", label: "Dashboard" },
  { path: "/requests", label: "Org Requests" },
  { path: "/organizations", label: "Organizations" },
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
          {NAV_ITEMS.map((item) => {
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
