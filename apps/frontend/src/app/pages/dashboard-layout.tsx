import { Outlet, useNavigate, useLocation } from "react-router";
import { useAppContext } from "../context/app-context";
import type { SessionType } from "../context/app-context";
import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { api } from "../../lib/api";
import {
  Vote,
  Calendar,
  Building2,
  Wallet,
  Settings,
  LogOut,
  User as UserIcon,
  PanelLeftClose,
  PanelLeftOpen,
  EllipsisVertical,
  Menu,
  X,
  ClipboardList,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { toast } from "sonner";

// ─── Nav items ────────────────────────────────────────────────────────────────

// ─── Explicit nav item type ───────────────────────────────────────────────────

// Re-introduces a per-item session-type gate — driven by what each
// destination page actually supports. Several items already render an
// in-page "not available for this session" notice
// for ORG sessions (My Requests, Identity Wallet — both UNIFIED-only), so
// linking to them from the nav for an ORG session was always a dead end
// the user only discovered after clicking through. `sessionTypes` lets the
// sidebar filter those out up front instead. SITEADMIN is included
// defensively on every item that both UNIFIED and ORG support — this
// dashboard isn't meant to be reached by a SITEADMIN session at all (see
// manage-organizations-view.tsx / manage-events-view.tsx), so there's no
// real case to design for there.
interface NavItemConfig {
  path: string;
  label: string;
  icon: React.ElementType;
  sessionTypes: SessionType[];
  // True for an
  // item that an ORG session should only see if the member holds an
  // organizer role somewhere in the org — resolved once via GET /org/mine
  // below (organizerChecked/orgs) and applied generically in
  // visibleNavItems, rather than re-deriving per item. No effect on
  // UNIFIED/SITEADMIN sessions.
  organizerOnly?: boolean;
}

const NAV_ITEMS: NavItemConfig[] = [
  {
    path: "/dashboard/events",
    label: "Events",
    icon: Vote,
    sessionTypes: ["UNIFIED", "ORG"],
  },
  {
    path: "/dashboard/manage-events",
    label: "Manage Events",
    icon: Calendar,
    sessionTypes: ["UNIFIED", "ORG"],
    organizerOnly: true,
  },
  // For an ORG session this tab is now organizer-gated rather than
  // dropped outright — an organizer still needs it to manage members/
  // scopes within their role scope (manage-organizations-view.tsx already
  // scopes everything it shows/does to the caller's own organizer scopes
  // via the backend, e.g. getCallerOrganizerScopes/assertOrganizerAccess).
  // A plain, non-organizer ORG member has nothing to do here — for them
  // org identity lives in Account and events in the Events/Manage Events
  // tabs — so the tab stays hidden in that case, same as before.
  {
    path: "/dashboard/organizations",
    label: "Organizations",
    icon: Building2,
    sessionTypes: ["UNIFIED", "ORG"],
    organizerOnly: true,
  },
  // Tracking counterpart to the
  // Organizations page's "Request Org" flow. my-org-requests-view.tsx
  // shows a notice for any non-UNIFIED session, so this is UNIFIED-only —
  // mirrors Identity Wallet's own UNIFIED-only gate one row down.
  {
    path: "/dashboard/my-requests",
    label: "My Requests",
    icon: ClipboardList,
    sessionTypes: ["UNIFIED"],
  },
  {
    path: "/dashboard/identity-wallet",
    label: "Identity Wallet",
    icon: Wallet,
    sessionTypes: ["UNIFIED"],
  },
  {
    path: "/dashboard/account",
    label: "Account",
    icon: Settings,
    sessionTypes: ["UNIFIED", "ORG"],
  },
];

// ─── Session type badge ───────────────────────────────────────────────────────

const SESSION_BADGE: Record<SessionType, { label: string; className: string }> =
  {
    UNIFIED: {
      label: "Unified",
      className: "bg-primary/10 text-primary border-primary/20",
    },
    ORG: {
      label: "Organization",
      className: "bg-violet-50 text-violet-700 border-violet-200",
    },
    SITEADMIN: {
      label: "Site Admin",
      className: "bg-amber-50 text-amber-700 border-amber-200",
    },
  };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(firstName?: string, lastName?: string) {
  const a = firstName?.trim()[0] ?? "";
  const b = lastName?.trim()[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

function getDisplayName(firstName?: string, lastName?: string) {
  return [firstName, lastName].filter(Boolean).join(" ") || "User";
}

// ─── Brand mark ───────────────────────────────────────────────────────────────

function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      aria-hidden="true"
      className="flex-shrink-0"
    >
      <circle cx="40" cy="40" r="37" fill="#1e40af" />
      <circle
        cx="40"
        cy="40"
        r="28"
        stroke="#6B8AFF"
        strokeWidth="2.5"
        fill="none"
        strokeDasharray="158 18"
        transform="rotate(-90 40 40)"
        strokeLinecap="round"
      />
      <path
        d="M21 40 L33 52 L59 24"
        stroke="white"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

// ─── Sidebar nav item ─────────────────────────────────────────────────────────

function NavItem({
  item,
  isActive,
  onClick,
  collapsed,
}: {
  item: NavItemConfig;
  isActive: boolean;
  onClick: () => void;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      aria-current={isActive ? "page" : undefined}
      // Soft tint for the active item (instead of a solid fill) so the
      // highlight doesn't dominate the screen. min-h-11 keeps a 44px
      // touch target on phones.
      className={`w-full flex items-center gap-3 px-3 min-h-11 md:min-h-10 rounded-lg text-sm font-medium transition-colors
        ${
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        } ${collapsed ? "justify-center" : ""}`}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      {!collapsed && (
        <span className="flex-1 text-left truncate">{item.label}</span>
      )}
    </button>
  );
}

// ─── User menu ────────────────────────────────────────────────────────────────
// One dropdown, two triggers: the sidebar footer card (desktop) and the avatar
// button in the mobile header. `children` is the trigger element.

interface UserMenuProps {
  children: ReactNode;
  side: "top" | "right" | "bottom" | "left";
  align: "start" | "center" | "end";
  displayName: string;
  email?: string | null;
  mobile?: string | null;
  orgUid?: string | null;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

function UserMenu({
  children,
  side,
  align,
  displayName,
  email,
  mobile,
  orgUid,
  onNavigate,
  onLogout,
}: UserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-56 max-w-[calc(100vw-1.5rem)]"
      >
        <DropdownMenuLabel className="font-normal">
          <div className="space-y-1">
            <p className="text-sm font-semibold leading-none">{displayName}</p>
            {email && (
              <p className="text-xs text-muted-foreground truncate">{email}</p>
            )}
            {mobile && !email && (
              <p className="text-xs text-muted-foreground">{mobile}</p>
            )}
            {orgUid && (
              <p className="text-xs font-mono text-muted-foreground">
                UID: {orgUid}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onNavigate("/dashboard/account")}>
          <UserIcon className="mr-2 h-4 w-4" />
          Manage Account
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onNavigate("/dashboard/identity-wallet")}
        >
          <Wallet className="mr-2 h-4 w-4" />
          Identity Wallet
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onLogout}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (path: string) => void;
  isActive: (path: string) => boolean;
  navItems: NavItemConfig[];
  // Desktop owns the brand and the user card. The phone drawer sits under a
  // header that already shows both, so it renders neither.
  showBrand: boolean;
  renderUser?: (collapsed: boolean) => ReactNode;
}

function Sidebar({
  collapsed,
  onToggle,
  onNavigate,
  isActive,
  navItems,
  showBrand,
  renderUser,
}: SidebarProps) {
  // Dividers only appear when the nav list actually scrolls under the header
  // or footer (short screens, many items); otherwise the sidebar stays line-free.
  const listRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      const top = el.scrollTop > 2;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      setEdges((prev) =>
        prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [navItems.length, collapsed]);

  return (
    <nav className="flex flex-col h-full" aria-label="Main navigation">
      {showBrand && (
        <>
          {/* Brand row doubles as the collapse control: a panel icon at the
                  right edge when expanded; when collapsed the logo itself turns
                  into the expand button on hover/focus. */}
          <div
            className={`flex items-center h-16 flex-shrink-0 px-3 border-b transition-colors ${edges.top ? "border-border" : "border-transparent"} ${collapsed ? "justify-center" : "gap-2.5"}`}
          >
            {collapsed ? (
              <button
                onClick={onToggle}
                className="group relative flex h-9 w-9 items-center justify-center rounded-lg hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring outline-none"
                title="Expand sidebar (Ctrl+B)"
                aria-label="Expand sidebar"
              >
                <span className="transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                  <BrandMark size={28} />
                </span>
                <PanelLeftOpen className="absolute h-5 w-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              </button>
            ) : (
              <>
                <BrandMark />
                <span className="flex-1 text-base font-bold tracking-tight truncate">
                  VoteCore
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={onToggle}
                  title="Collapse sidebar (Ctrl+B)"
                  aria-label="Collapse sidebar"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </>
      )}

      <div
        ref={listRef}
        className={`flex-1 space-y-0.5 px-2 overflow-y-auto overscroll-contain ${showBrand ? "pt-2" : "pt-3"}`}
      >
        {navItems.map((item) => (
          <NavItem
            key={item.path}
            item={item}
            isActive={isActive(item.path)}
            collapsed={collapsed}
            onClick={() => onNavigate(item.path)}
          />
        ))}
      </div>

      {(renderUser || !showBrand) && (
        <div
          className={`border-t transition-colors p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] space-y-1 ${edges.bottom ? "border-border" : "border-transparent"}`}
        >
          {renderUser?.(collapsed)}
          {/* Phone drawer has no brand row, so it keeps a labelled toggle here. */}
          {!showBrand && (
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-full gap-2 text-muted-foreground hover:text-foreground"
              onClick={onToggle}
              title={collapsed ? "Expand menu" : "Collapse menu"}
              aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
              {!collapsed && (
                <span className="text-xs font-medium">Collapse</span>
              )}
            </Button>
          )}
        </div>
      )}
    </nav>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────
// Layout: a full-height sidebar on md+ (brand at the top, user card at the
// bottom) and NO top bar. Each page already renders its own <h1>, so a top bar
// would only repeat the page name. Below md there is no room for a permanent
// sidebar, so a slim header (menu button, brand, avatar) opens it as a drawer.

export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, session, logout, orgs, setOrgs } = useAppContext();

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("sidebarCollapsed", sidebarCollapsed ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [sidebarCollapsed]);
  // The phone drawer remembers its own compact/expanded choice, separate from
  // the desktop sidebar's, so collapsing one never changes the other.
  const [mobileCollapsed, setMobileCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sidebarCollapsedMobile") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "sidebarCollapsedMobile",
        mobileCollapsed ? "1" : "0",
      );
    } catch {
      /* storage unavailable */
    }
  }, [mobileCollapsed]);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Ctrl/Cmd+B toggles the desktop sidebar (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "b") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      e.preventDefault();
      setSidebarCollapsed((c) => !c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Drawer hygiene: close on route change, on Escape, and when the viewport
  // grows past the md breakpoint. Page scroll is deliberately NOT locked via
  // body overflow: with html/body on overflow-x: clip that turns <body> into a
  // scroll container and detaches the sticky header (see index.css). The
  // backdrop is touch-none and the drawer overscroll-contain instead.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    const mql = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (mql.matches) setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    mql.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("keydown", onKey);
      mql.removeEventListener("change", onChange);
    };
  }, [mobileOpen]);

  // See the NAV_ITEMS notes above: organizerChecked only flips to true on a
  // successful GET /org/mine, so a transient failure hides nothing.
  const [organizerChecked, setOrganizerChecked] = useState(false);

  useEffect(() => {
    if (session?.type !== "ORG") return;
    let cancelled = false;

    api
      .getMyOrgs()
      .then((data) => {
        if (cancelled) return;
        setOrgs(data);
        setOrganizerChecked(true);
      })
      .catch(() => {
        // leave organizerChecked=false
      });

    return () => {
      cancelled = true;
    };
  }, [session?.type, session?.orgid, session?.uid]);

  const visibleNavItems = useMemo(
    () =>
      NAV_ITEMS.filter((n) => {
        if (
          session?.type &&
          !n.sessionTypes.includes(session.type as SessionType)
        ) {
          return false;
        }
        if (
          n.organizerOnly &&
          session?.type === "ORG" &&
          organizerChecked &&
          orgs.length === 0
        ) {
          return false;
        }
        return true;
      }),
    [session?.type, organizerChecked, orgs.length],
  );

  const userInitials = useMemo(
    () => getInitials(user?.first_name, user?.last_name),
    [user?.first_name, user?.last_name],
  );

  const userDisplayName = useMemo(
    () => getDisplayName(user?.first_name, user?.last_name),
    [user?.first_name, user?.last_name],
  );

  const sessionInfo =
    session?.type && session.type in SESSION_BADGE
      ? SESSION_BADGE[session.type as SessionType]
      : null;

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/");
    } catch {
      toast.error("Sign out failed, try again");
    }
  };

  const isActive = (path: string) => location.pathname === path;

  const userMenuProps = {
    displayName: userDisplayName,
    email: user?.email,
    mobile: user?.mobile,
    orgUid: session?.type === "ORG" && session.uid ? String(session.uid) : null,
    onNavigate: (path: string) => navigate(path),
    onLogout: handleLogout,
  };

  const avatar = (
    <Avatar className="h-8 w-8 flex-shrink-0">
      <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
        {userInitials}
      </AvatarFallback>
    </Avatar>
  );

  // Desktop sidebar footer: avatar, name and session type; avatar only when collapsed.
  const renderSidebarUser = (collapsed: boolean) => (
    <UserMenu {...userMenuProps} side="right" align="end">
      <button
        className={`w-full flex items-center gap-2.5 rounded-xl p-2 text-left transition-colors bg-muted/50 hover:bg-accent ${collapsed ? "justify-center" : ""}`}
        aria-label="Open user menu"
        title={collapsed ? userDisplayName : undefined}
      >
        {avatar}
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight truncate">
                {userDisplayName}
              </p>
              {sessionInfo && (
                <Badge
                  variant="outline"
                  className={`mt-1 px-1.5 py-0 text-[11px] ${sessionInfo.className}`}
                >
                  {sessionInfo.label}
                </Badge>
              )}
            </div>
            <EllipsisVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          </>
        )}
      </button>
    </UserMenu>
  );

  return (
    <div className="min-h-dvh bg-background md:flex">
      {/* ── Mobile header (hidden on md+) ── */}
      <header className="md:hidden sticky top-0 z-40 border-b bg-background pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 px-3 h-14">
          <Button
            variant="ghost"
            size="icon"
            className="flex-shrink-0"
            aria-label={
              mobileOpen ? "Close navigation menu" : "Open navigation menu"
            }
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </Button>

          <div className="flex items-center gap-2 min-w-0 flex-1">
            <BrandMark size={28} />
            <span className="text-base font-bold tracking-tight truncate">
              VoteCore
            </span>
          </div>

          <UserMenu {...userMenuProps} side="bottom" align="end">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full flex-shrink-0"
              aria-label="Open user menu"
            >
              {avatar}
            </Button>
          </UserMenu>
        </div>
      </header>

      {/* ── Mobile drawer ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <button
            className="absolute inset-0 bg-black/40 cursor-default touch-none"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          />
          <aside
            className={`absolute left-0 top-[calc(3.5rem+env(safe-area-inset-top))] bottom-0 max-w-[70vw] bg-background border-r shadow-lg flex flex-col overscroll-contain transition-all duration-200 ${mobileCollapsed ? "w-16" : "w-max min-w-44"}`}
          >
            <Sidebar
              collapsed={mobileCollapsed}
              onToggle={() => setMobileCollapsed((c) => !c)}
              onNavigate={(path) => navigate(path)}
              isActive={isActive}
              navItems={visibleNavItems}
              showBrand={false}
            />
          </aside>
        </div>
      )}

      {/* ── Desktop sidebar: full height, owns brand + user ── */}
      <aside
        className={`hidden md:flex flex-col flex-shrink-0 border-r border-border/60 bg-background
          sticky top-0 h-dvh transition-all duration-200
          ${sidebarCollapsed ? "w-16" : "w-60"}`}
      >
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((c) => !c)}
          onNavigate={(path) => navigate(path)}
          isActive={isActive}
          navItems={visibleNavItems}
          showBrand={true}
          renderUser={renderSidebarUser}
        />
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0">
        <div className="p-4 sm:p-6 md:p-8 max-w-screen-xl mx-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
