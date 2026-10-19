import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Users, KanbanSquare, Wallet, FolderOpen } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { accountsApi } from '@/services/api';

interface NavigationItem {
  name: string;
  path: string;
  icon: React.ElementType;
}

interface SidebarProps {
  isOpen: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen }) => {
  const { user } = useAuthStore();
  const location = useLocation();

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  // Server decides — the allowlist of partner emails lives in the API's config.
  const [accountsAllowed, setAccountsAllowed] = useState(false);
  useEffect(() => {
    if (!user) { setAccountsAllowed(false); return; }
    accountsApi.access()
      .then((a) => setAccountsAllowed(a.allowed))
      .catch(() => setAccountsAllowed(false));
  }, [user?.id]);

  const items: NavigationItem[] = [
    // Every task route is 403 for a viewer — the board is a thing you work,
    // not a thing you watch — so the entry is hidden for them.
    ...(user?.role !== 'viewer' ? [{ name: 'Tasks', path: '/tasks', icon: KanbanSquare }] : []),
    // Account Management and Documents — the two partners' logins only (by email, not role).
    ...(accountsAllowed
      ? [
          { name: 'Account Management', path: '/accounts', icon: Wallet },
          { name: 'Documents', path: '/documents', icon: FolderOpen },
        ]
      : []),
    ...(user?.role === 'super_admin' ? [{ name: 'Team Management', path: '/users', icon: Users }] : []),
  ];

  const renderItem = (item: NavigationItem) => {
    const Icon = item.icon;
    const active = isActive(item.path);
    return (
      <Link
        key={item.path}
        to={item.path}
        title={!isOpen ? item.name : undefined}
        className={`
          flex items-center ${isOpen ? 'space-x-3 px-3' : 'justify-center px-0'} py-2.5 rounded-lg
          text-body font-medium transition-colors
          ${active
            ? 'bg-primary-500/10 text-muted-foreground border border-primary-500/20'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }
        `}
      >
        <Icon size={20} className={active ? 'text-muted-foreground' : ''} />
        {isOpen && <span className="whitespace-nowrap">{item.name}</span>}
      </Link>
    );
  };

  return (
    <div
      className={`flex flex-col bg-background border-r border-border h-screen sticky top-0 transition-all duration-300 ${isOpen ? 'w-64' : 'w-16'
        }`}
    >
      <div className="flex items-center justify-center h-16 border-b border-border overflow-hidden">
        {isOpen ? (
          <div className="flex items-center gap-2.5 whitespace-nowrap">
            <img src="/logo-mark.png" alt="Kavas Capital" className="h-[22px] w-auto invert dark:invert-0" />
            <h1 className="text-title font-bold tracking-tighter">
              <span className="text-muted-foreground">Kavas Capital-</span><span className="text-foreground">Legal</span>
            </h1>
          </div>
        ) : (
          <img src="/logo-mark.png" alt="Kavas Capital" className="h-[22px] w-auto invert dark:invert-0" />
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-4">
        <div className={`space-y-1 ${isOpen ? 'px-3' : 'px-2'}`}>
          {items.map(renderItem)}
        </div>
      </nav>
    </div>
  );
};
