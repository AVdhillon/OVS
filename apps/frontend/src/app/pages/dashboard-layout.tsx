import { Outlet, useNavigate, useLocation } from 'react-router';
import { useAppContext } from '../context/app-context';
import type { SessionType } from '../context/app-context';
import { useState, useMemo, useEffect } from 'react';
import { api } from '../../lib/api';
import {
  Vote,
  Calendar,
  Building2,
  Wallet,
  Settings,
  LogOut,
  User as UserIcon,
  ChevronRight,
  Menu,
  X,
  ClipboardList,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Separator } from '../components/ui/separator';
import { toast } from 'sonner';

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
  { path: '/dashboard/events',          label: 'Events',           icon: Vote,          sessionTypes: ['UNIFIED', 'ORG'] },
  { path: '/dashboard/manage-events',   label: 'Manage Events',    icon: Calendar,      sessionTypes: ['UNIFIED', 'ORG'], organizerOnly: true },
  // For an ORG session this tab is now organizer-gated rather than
  // dropped outright — an organizer still needs it to manage members/
  // scopes within their role scope (manage-organizations-view.tsx already
  // scopes everything it shows/does to the caller's own organizer scopes
  // via the backend, e.g. getCallerOrganizerScopes/assertOrganizerAccess).
  // A plain, non-organizer ORG member has nothing to do here — for them
  // org identity lives in Account and events in the Events/Manage Events
  // tabs — so the tab stays hidden in that case, same as before.
  { path: '/dashboard/organizations',   label: 'Organizations',    icon: Building2,     sessionTypes: ['UNIFIED', 'ORG'], organizerOnly: true },
  // Tracking counterpart to the
  // Organizations page's "Request Org" flow. my-org-requests-view.tsx
  // shows a notice for any non-UNIFIED session, so this is UNIFIED-only —
  // mirrors Identity Wallet's own UNIFIED-only gate one row down.
  { path: '/dashboard/my-requests',     label: 'My Requests',      icon: ClipboardList, sessionTypes: ['UNIFIED'] },
  { path: '/dashboard/identity-wallet', label: 'Identity Wallet',  icon: Wallet,        sessionTypes: ['UNIFIED'] },
  { path: '/dashboard/account',         label: 'Account',          icon: Settings,      sessionTypes: ['UNIFIED', 'ORG'] },
];

// ─── Session type badge ───────────────────────────────────────────────────────

const SESSION_BADGE: Record<SessionType, { label: string; className: string }> = {
  UNIFIED:   { label: 'Unified',      className: 'bg-primary/10 text-primary border-primary/20'   },
  ORG:       { label: 'Organization', className: 'bg-violet-50 text-violet-700 border-violet-200' },
  SITEADMIN: { label: 'Site Admin',   className: 'bg-amber-50 text-amber-700 border-amber-200'    },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(firstName?: string, lastName?: string) {
  const a = firstName?.trim()[0] ?? '';
  const b = lastName?.trim()[0] ?? '';
  return (a + b).toUpperCase() || '?';
}

function getDisplayName(firstName?: string, lastName?: string) {
  return [firstName, lastName].filter(Boolean).join(' ') || 'User';
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
          // 3a: aria-current for screen readers to identify the active route
          aria-current={isActive ? 'page' : undefined}
          className={`w-full flex items-center gap-3 px-3 py-3 md:py-2.5 rounded-lg text-sm font-medium transition-colors
        ${isActive
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          } ${collapsed ? 'justify-center' : ''}`}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
        {!collapsed && isActive && <ChevronRight className="h-3.5 w-3.5 opacity-60 flex-shrink-0" />}
      </button>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
// 1: Extracted from a plain function call inside DashboardLayout into a
//         proper React component so reconciliation and hooks work correctly.

interface SidebarProps {
  collapsed: boolean;
  showToggle: boolean;
  onToggle: () => void;
  onNavigate: (path: string) => void;
  isActive: (path: string) => boolean;
  navItems: NavItemConfig[];
}

function Sidebar({ collapsed, showToggle, onToggle, onNavigate, isActive, navItems }: SidebarProps) {
  return (
      <nav className="flex flex-col h-full">
        {/* Logo */}
        <div className={`flex items-center gap-2.5 px-3 py-4 ${collapsed ? 'justify-center' : ''}`}>
          <div className="flex-shrink-0">
            <svg width="32" height="32" viewBox="0 0 80 80" aria-hidden="true">
              <circle cx="40" cy="40" r="37" fill="#1e40af"/>
              <circle cx="40" cy="40" r="28" stroke="#6B8AFF" strokeWidth="2.5" fill="none"
                      strokeDasharray="158 18" transform="rotate(-90 40 40)" strokeLinecap="round"/>
              <path d="M21 40 L33 52 L59 24" stroke="white" strokeWidth="7"
                    strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
          </div>
          {!collapsed && (
              <span className="text-base font-bold tracking-tight">VoteCore</span>
          )}
        </div>

        <Separator className="mb-3" />

        {/* Nav items */}
        <div className="flex-1 space-y-0.5 px-2 overflow-y-auto">
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

        {/* Same ChevronRight icon in both states (rotated 180° when expanded).
             Shown in the desktop sidebar and the phone drawer alike; the
             label makes the action obvious on touch screens. */}
        {showToggle && (
            <div className="border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 w-full gap-2 text-muted-foreground hover:text-foreground md:h-8"
                  onClick={onToggle}
                  title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <ChevronRight className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
                {!collapsed && <span className="text-xs font-medium">Collapse</span>}
              </Button>
            </div>
        )}
      </nav>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, session, logout, orgs, setOrgs } = useAppContext();

  // Compact-sidebar preference: shared by the phone drawer and the desktop
  // sidebar, and remembered across drawer opens, rotations and reloads.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('sidebarCollapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  }, [sidebarCollapsed]);
  const [mobileOpen, setMobileOpen] = useState(false);

  // A plain ORG member (no
  // organizer role in any scope of this org) has no use for Manage Events
  // — every action on that page requires being an organizer somewhere.
  // GET /org/mine already resolves exactly this for an ORG session
  // (org.service.ts::getMyOrgForOrgSession returns [] when the caller
  // holds no organizer role anywhere in the org, [org] otherwise), so
  // that's reused here rather than adding a second way to ask the same
  // question. Populating it into the shared context also means
  // manage-events-view.tsx's own `if (orgs.length === 0) loadOrgs()` on
  // mount is a no-op once this has already resolved.
  //
  // `organizerChecked` starts false and is only ever flipped to true on a
  // *successful* resolution — a failed fetch leaves it false so a
  // transient network error hides nothing (see the NAV_ITEMS filter
  // below, which shows Manage Events until this is known either way).
  const [organizerChecked, setOrganizerChecked] = useState(false);

  useEffect(() => {
    if (session?.type !== 'ORG') return;
    let cancelled = false;

    api
      .getMyOrgs()
      .then((data) => {
        if (cancelled) return;
        setOrgs(data);
        setOrganizerChecked(true);
      })
      .catch(() => {
        // leave organizerChecked=false — see comment above
      });

    return () => {
      cancelled = true;
    };
  }, [session?.type, session?.orgid, session?.uid]);

  // 6: Memoize derived values that depend on stable inputs so they are
  //         not recomputed on every render caused by unrelated state changes.
  // NOTE: deliberately looked up against the *unfiltered* NAV_ITEMS — a
  // direct URL visit to a page that's been filtered out of the sidebar for
  // this session type should still show a correct breadcrumb, not fall
  // back to "Dashboard".
  const currentNav = useMemo(
      () => NAV_ITEMS.find((n) => n.path === location.pathname),
      [location.pathname],
  );

  // The sidebar's actual item
  // list, filtered by session type. While the session hasn't resolved yet
  // (`!session?.type`, during initial load) show everything rather than
  // nothing, so there's no flash of an empty sidebar before it loads.
  //
  // A second,
  // `organizerOnly`-driven filter layered on top of the session-type
  // filter — applies the same organizer check generically to every item
  // marked organizerOnly (Manage Events, Organizations) instead of
  // special-casing one path. Same "show rather than hide while unresolved"
  // reasoning as the session-type filter above: only hide once
  // organizerChecked is true and the resolved org list came back empty.
  const visibleNavItems = useMemo(
      () =>
          NAV_ITEMS.filter((n) => {
            if (session?.type && !n.sessionTypes.includes(session.type as SessionType)) {
              return false;
            }
            if (
                n.organizerOnly &&
                session?.type === 'ORG' &&
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

  // 5: Guard SESSION_BADGE lookup so an unexpected session.type from the
  //         API never crashes with an undefined access.
  const sessionInfo =
      session?.type && session.type in SESSION_BADGE
          ? SESSION_BADGE[session.type as SessionType]
          : null;

  // 2: navigate('/') is now inside the try block so a failed logout keeps
  //         the user on the current page instead of always redirecting.
  const handleLogout = async () => {
    try {
      await logout();
      navigate('/');
    } catch {
      toast.error('Sign out failed, try again');
    }
  };

  const isActive = (path: string) => location.pathname === path;

  // The collapsed preference is deliberately NOT reset here any more, so the
  // drawer reopens in whichever mode the user last chose.
  const handleMobileToggle = () => setMobileOpen((open) => !open);

  const handleSidebarNavigate = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
      <div className="min-h-dvh bg-background flex flex-col">

        {/* ── Top bar ── */}
        <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 h-14">

            {/* Mobile menu toggle */}
            <Button
                variant="ghost"
                size="icon"
                className="md:hidden flex-shrink-0"
                aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={mobileOpen}
                // 4: uses extracted handler that resets collapsed state
                onClick={handleMobileToggle}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>

            {/* Breadcrumb / page title */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-muted-foreground">
                {currentNav?.label ?? 'Dashboard'}
              </p>
            </div>

            {/* Session badge */}
            {/* Dropped the inline
                UID — it was always visible in the sticky header on every page
                for any ORG session, pure decoration for a plain voter. Moved
                into the user-menu dropdown below (parallel to the existing
                UNIFIED-only PID row), which the user already has to opt into
                opening. */}
            {sessionInfo && (
                <Badge
                    variant="outline"
                    className={`hidden sm:flex flex-shrink-0 text-xs px-2.5 py-0.5 ${sessionInfo.className}`}
                >
                  {sessionInfo.label}
                </Badge>
            )}

            {/* User menu */}
            <DropdownMenu>
              {/* 3b: aria-label so screen readers announce the button purpose */}
              <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full flex-shrink-0"
                    aria-label="Open user menu"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                      {/* 6: use memoized value instead of inline call */}
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-w-[calc(100vw-1.5rem)]">
                <DropdownMenuLabel className="font-normal">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold leading-none">
                      {/* 6: use memoized value instead of inline call */}
                      {userDisplayName}
                    </p>
                    {user?.email && (
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    )}
                    {user?.mobile && !user?.email && (
                        <p className="text-xs text-muted-foreground">{user.mobile}</p>
                    )}
                    {/* PID row removed — nothing in the app ever asks
                        the user to know or quote back their PID (org
                        linking uses orgid+UID, org requests use
                        reference_code, and there's no support/contact flow
                        that references it), so it was pure internal-ID
                        clutter with no user-facing purpose. */}
                    {/* Parallel
                        row for ORG sessions — the UID this now replaces used
                        to live in the always-visible top-bar badge. */}
                    {session?.type === 'ORG' && session.uid && (
                        <p className="text-xs font-mono text-muted-foreground">
                          UID: {session.uid}
                        </p>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/dashboard/account')}>
                  <UserIcon className="mr-2 h-4 w-4" />
                  Manage Account
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/dashboard/identity-wallet')}>
                  <Wallet className="mr-2 h-4 w-4" />
                  Identity Wallet
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={handleLogout}
                    className="text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

          </div>
        </header>

        <div className="flex flex-1">

          {/* ── Mobile overlay sidebar ── */}
          {mobileOpen && (
              <div className="fixed inset-0 z-30 md:hidden">
                {/* 3c: changed from div to button so it is keyboard-accessible
                        and screen readers know it closes the menu */}
                <button
                    className="absolute inset-0 bg-black/40 cursor-default"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Close menu"
                />
                <aside className={`absolute left-0 top-14 bottom-0 max-w-[85vw] bg-background border-r shadow-lg flex flex-col transition-all duration-200 ${sidebarCollapsed ? 'w-16' : 'w-64'}`}>
                  {/* Same Sidebar component as desktop, including the compact toggle */}
                  <Sidebar
                      collapsed={sidebarCollapsed}
                      showToggle={true}
                      onToggle={() => setSidebarCollapsed((c) => !c)}
                      onNavigate={handleSidebarNavigate}
                      isActive={isActive}
                      navItems={visibleNavItems}
                  />
                </aside>
              </div>
          )}

          {/* ── Desktop sidebar ── */}
          <aside
              className={`hidden md:flex flex-col flex-shrink-0 border-r bg-background
            sticky top-14 h-[calc(100dvh-3.5rem)] overflow-y-auto transition-all duration-200
            ${sidebarCollapsed ? 'w-16' : 'w-56'}`}
          >
            {/* 1: real Sidebar component instead of sidebarContent() */}
            <Sidebar
                collapsed={sidebarCollapsed}
                showToggle={true}
                onToggle={() => setSidebarCollapsed((c) => !c)}
                onNavigate={(path) => navigate(path)}
                isActive={isActive}
                navItems={visibleNavItems}
            />
          </aside>

          {/* ── Main content ── */}
          <main className="flex-1 min-w-0">
            <div className="p-4 sm:p-6 md:p-8 max-w-screen-xl mx-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Outlet />
            </div>
          </main>

        </div>
      </div>
  );
}