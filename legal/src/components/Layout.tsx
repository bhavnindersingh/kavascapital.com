import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export const Layout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebarOpen');
      return saved === null ? true : JSON.parse(saved);
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try { localStorage.setItem('sidebarOpen', JSON.stringify(sidebarOpen)); } catch { /* storage unavailable */ }
  }, [sidebarOpen]);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar isOpen={sidebarOpen} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} sidebarOpen={sidebarOpen} />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
