import { Outlet, useNavigate, useLocation } from 'react-router';
import { useAppContext } from '../context/app-context';
import type { SessionType } from '../context/app-context';
import { useState, useMemo } from 'react';
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

// EDIT (Phase 1 — auth model consolidation, subphase 1.8): dropped the
// `hiddenFor` mechanism — it existed solely to hide organizer-only items
// from GOV sessions, which no longer exist. UNIFIED and ORG (the only
// session types this app's own login ever produces — see app-context.tsx's
// SessionType note) were always shown these items regardless, so nothing
// is hidden now and there's no remaining case for a hiddenFor list to gate.
interface NavItemConfig {
  path: string;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItemConfig[] = [
  { path: '/dashboard/events',          label: 'Events',           icon: Vote     },
  { path: '/dashboard/manage-events',   label: 'Manage Events',    icon: Calendar },
  { path: '/dashboard/organizations',   label: 'Organizations',    icon: Building2 },
  // EDIT (Phase 4 — cutover, subphase 4.7): tracking counterpart to the
  // Organizations page's "Request Org" flow (4.6) — not gated out of
  // NAV_ITEMS for non-UNIFIED sessions, same as every other item here since
  // 1.8; the page itself shows a notice instead (mirrors Identity Wallet's
  // own UNIFIED-only gate one row up).
  { path: '/dashboard/my-requests',     label: 'My Requests',      icon: ClipboardList },
  { path: '/dashboard/identity-wallet', label: 'Identity Wallet',  icon: Wallet   },
  { path: '/dashboard/account',         label: 'Account',          icon: Settings },
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
          // FIX 3a: aria-current for screen readers to identify the active route
          aria-current={isActive ? 'page' : undefined}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
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
// FIX 1: Extracted from a plain function call inside DashboardLayout into a
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
            <svg width="32" height="32" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="37" fill="#1e40af"/>
              <circle cx="40" cy="40" r="28" stroke="#6B8AFF" stroke-width="2.5" fill="none"
                      stroke-dasharray="158 18" transform="rotate(-90 40 40)" stroke-linecap="round"/>
              <path d="M21 40 L33 52 L59 24" stroke="white" stroke-width="7"
                    stroke-linecap="round" stroke-linejoin="round" fill="none"/>
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

        {/* FIX 7: Both states use the same ChevronRight icon — rotate-180 for
                 expanded — so the toggle is visually consistent either way.
          FIX 6 (mobile): showToggle=false on mobile prevents a useless
                 w-16 collapsed drawer. */}
        {showToggle && (
            <div className="p-2">
              <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground hover:text-foreground"
                  onClick={onToggle}
                  title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <ChevronRight className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
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
  const { user, session, logout } = useAppContext();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // FIX 6: Memoize derived values that depend on stable inputs so they are
  //         not recomputed on every render caused by unrelated state changes.
  const currentNav = useMemo(
      () => NAV_ITEMS.find((n) => n.path === location.pathname),
      [location.pathname],
  );

  const userInitials = useMemo(
      () => getInitials(user?.first_name, user?.last_name),
      [user?.first_name, user?.last_name],
  );

  const userDisplayName = useMemo(
      () => getDisplayName(user?.first_name, user?.last_name),
      [user?.first_name, user?.last_name],
  );

  // FIX 5: Guard SESSION_BADGE lookup so an unexpected session.type from the
  //         API never crashes with an undefined access.
  const sessionInfo =
      session?.type && session.type in SESSION_BADGE
          ? SESSION_BADGE[session.type as SessionType]
          : null;

  // FIX 2: navigate('/') is now inside the try block so a failed logout keeps
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

  // FIX 4: Reset sidebarCollapsed to false whenever the mobile drawer opens so
  //         the user never gets a barely-usable 64 px mobile panel.
  const handleMobileToggle = () => {
    setMobileOpen((open) => {
      if (!open) setSidebarCollapsed(false);
      return !open;
    });
  };

  const handleSidebarNavigate = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
      <div className="min-h-screen bg-background flex flex-col">

        {/* ── Top bar ── */}
        <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-3 px-4 h-14">

            {/* Mobile menu toggle */}
            <Button
                variant="ghost"
                size="icon"
                className="md:hidden flex-shrink-0"
                // FIX 4: uses extracted handler that resets collapsed state
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
            {sessionInfo && (
                <Badge
                    variant="outline"
                    className={`hidden sm:flex flex-shrink-0 text-xs px-2.5 py-0.5 ${sessionInfo.className}`}
                >
                  {sessionInfo.label}
                  {session?.type === 'ORG' && session.uid && (
                      <span className="ml-1.5 font-mono opacity-75">{session.uid}</span>
                  )}
                </Badge>
            )}

            {/* User menu */}
            <DropdownMenu>
              {/* FIX 3b: aria-label so screen readers announce the button purpose */}
              <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full flex-shrink-0"
                    aria-label="Open user menu"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                      {/* FIX 6: use memoized value instead of inline call */}
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold leading-none">
                      {/* FIX 6: use memoized value instead of inline call */}
                      {userDisplayName}
                    </p>
                    {user?.email && (
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    )}
                    {user?.mobile && !user?.email && (
                        <p className="text-xs text-muted-foreground">{user.mobile}</p>
                    )}
                    {user?.pid && (
                        <p className="text-xs font-mono text-muted-foreground">
                          PID: {user.pid}
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
                {/* FIX 3c: changed from div to button so it is keyboard-accessible
                        and screen readers know it closes the menu */}
                <button
                    className="absolute inset-0 bg-black/40 cursor-default"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Close menu"
                />
                <aside className={`absolute left-0 top-14 bottom-0 bg-background border-r shadow-lg flex flex-col transition-all duration-200 ${sidebarCollapsed ? 'w-16' : 'w-64'}`}>
                  {/* FIX 1: real Sidebar component instead of sidebarContent()
                  FIX 6 (mobile side): showToggle=false — no collapse on mobile */}
                  <Sidebar
                      collapsed={sidebarCollapsed}
                      showToggle={false}
                      onToggle={() => setSidebarCollapsed((c) => !c)}
                      onNavigate={handleSidebarNavigate}
                      isActive={isActive}
                      navItems={NAV_ITEMS}
                  />
                </aside>
              </div>
          )}

          {/* ── Desktop sidebar ── */}
          <aside
              className={`hidden md:flex flex-col flex-shrink-0 border-r bg-background
            sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto transition-all duration-200
            ${sidebarCollapsed ? 'w-16' : 'w-56'}`}
          >
            {/* FIX 1: real Sidebar component instead of sidebarContent() */}
            <Sidebar
                collapsed={sidebarCollapsed}
                showToggle={true}
                onToggle={() => setSidebarCollapsed((c) => !c)}
                onNavigate={(path) => navigate(path)}
                isActive={isActive}
                navItems={NAV_ITEMS}
            />
          </aside>

          {/* ── Main content ── */}
          <main className="flex-1 min-w-0">
            <div className="p-6 md:p-8 max-w-screen-xl mx-auto">
              <Outlet />
            </div>
          </main>

        </div>
      </div>
  );
}