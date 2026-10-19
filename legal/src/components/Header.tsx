import React from 'react';
import { Menu, LogOut, Sun, Moon } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';

import { Button } from '@/components/ui/button';

interface HeaderProps {
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();

  return (
    <header className="bg-background border-b border-border h-16 sticky top-0 z-40">
      <div className="flex items-center h-full">
        <Button variant="secondary" size="inline"
          onClick={onToggleSidebar}
          className="p-2 ml-4 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Toggle sidebar"
        >
          <Menu size={24} />
        </Button>

        <div className="flex-1" />

        <div className="flex items-center space-x-6 pr-4 shrink-0">
          {/* Day / night — whole-app theme, remembered per browser */}
          <Button variant="secondary" size="inline"
            onClick={toggleTheme}
            className="p-2 rounded-xl bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-all"
            title={theme === 'dark' ? 'Switch to day mode' : 'Switch to night mode'}
            aria-label={theme === 'dark' ? 'Switch to day mode' : 'Switch to night mode'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </Button>

          <div className="h-6 w-px bg-border hidden sm:block" />

          <div className="flex items-center gap-3">
            <div className="text-right hidden md:block">
              <div className="text-meta font-semibold text-foreground leading-tight">{user?.full_name}</div>
              <div className="text-micro font-medium text-muted-foreground leading-tight capitalize">{user?.role}</div>
            </div>
            <Button variant="secondary" size="inline"
              onClick={logout}
              className="p-2 rounded-xl bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-all group"
              title="Sign Out"
            >
              <LogOut size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};
