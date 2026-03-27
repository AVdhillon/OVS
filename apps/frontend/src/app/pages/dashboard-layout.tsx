import { Outlet, useNavigate, useLocation } from 'react-router';
import { useAppContext, type User } from '../context/app-context';
import { api, setToken } from '../../lib/api';
import {
  Calendar,
  Settings,
  Building2,
  Wallet,
  Vote,
  Bell,
  User as UserIcon,   // ← was just `UserIcon` which doesn't exist in lucide
  LogOut,
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

export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, activeIdentity, setUser, setActiveIdentity } = useAppContext();

  const menuItems = [
    { path: '/dashboard/events', label: 'Events', icon: Vote },
    { path: '/dashboard/manage-events', label: 'Manage My Events', icon: Calendar },
    { path: '/dashboard/organizations', label: 'Manage Organizations', icon: Building2 },
    { path: '/dashboard/identity-wallet', label: 'Identity Wallet', icon: Wallet },
    { path: '/dashboard/account', label: 'Manage Account', icon: Settings },
  ];

  const handleLogout = async () => {
    try {
      await api.logout();           // deactivates DB session
    } catch (_) {
      // proceed even if backend call fails
    }
    setToken(null);                 // clears localStorage token
    setUser(null);
    setActiveIdentity(null);
    navigate('/');
  };

  const getInitials = (user: User | null) => {
    if (!user?.firstName) return '?';
    return (user.firstName[0] + (user.lastName?.[0] ?? '')).toUpperCase();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top App Bar */}
      <header className="bg-white border-b sticky top-0 z-40">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="text-[#1e40af]">
              <Vote className="h-8 w-8" />
            </div>
            <h1 className="text-2xl">VoteCore</h1>
          </div>

          <div className="flex items-center gap-4">
            {activeIdentity && (
              <Badge variant="outline" className="px-3 py-1 bg-blue-50 border-blue-200">
                {activeIdentity.displayName}
              </Badge>
            )}

            <Button variant="ghost" size="icon">
              <Bell className="h-5 w-5" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                  <Avatar>
                    <AvatarFallback className="bg-[#1e40af] text-white">
                      {getInitials(user)}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p>{user?.firstName} {user?.lastName}</p>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                    <p className="text-xs text-muted-foreground">PID: {user?.pid}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/dashboard/account')}>
                  <UserIcon className="mr-2 h-4 w-4" />
                  Manage Account
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="w-64 bg-white border-r min-h-[calc(100vh-65px)] sticky top-[65px]">
          <nav className="p-4 space-y-2">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                location.pathname === item.path ||
                (item.path === '/dashboard/events' && location.pathname === '/dashboard');

              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-[#1e40af] text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}