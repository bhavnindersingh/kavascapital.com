import React, { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { accountsApi } from '@/services/api';
import { Layout } from '@/components/Layout';
import LoginPage from '@/pages/LoginPage';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import { Loader2 } from 'lucide-react';

const UserManagementPage = lazy(() => import('@/pages/UserManagementPage'));
const AccountManagementPage = lazy(() => import('@/pages/AccountManagementPage'));
const DocumentsPage = lazy(() => import('@/pages/DocumentsPage'));
const TasksPage = lazy(() => import('@/pages/TasksPage'));

const App: React.FC = () => {
  const { isAuthenticated, isLoading, checkPlatformSession, user } = useAuthStore();

  // Restore the Supabase session once per page load.
  useEffect(() => {
    checkPlatformSession();
  }, [checkPlatformSession]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground font-medium">Loading…</p>
        </div>
      </div>
    );
  }

  // Logged-out visitors only ever see the login and password-reset pages. No
  // authenticated route exists in the tree, so nothing behind the login can
  // render or be reached by URL.
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      {/* A recovery link signs the user in first, then lands here. */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route
          path="users"
          element={
            user?.role !== 'super_admin' ? (
              <Navigate to="/" replace />
            ) : (
              <Suspense fallback={<Loader />}>
                <UserManagementPage />
              </Suspense>
            )
          }
        />
        <Route
          path="accounts"
          element={
            // Gated by login EMAIL, not role (the two partners only). The page
            // asks /platform/accounts/access itself and sends anyone else home;
            // the API refuses them regardless.
            <Suspense fallback={<Loader />}>
              <AccountManagementPage />
            </Suspense>
          }
        />
        <Route
          path="documents"
          element={
            // Same partners-only gate as /accounts: the page checks access itself.
            <Suspense fallback={<Loader />}>
              <DocumentsPage />
            </Suspense>
          }
        />
        <Route
          path="tasks"
          element={
            user?.role === 'viewer' ? (
              <Navigate to="/accounts" replace />
            ) : (
              <Suspense fallback={<Loader />}>
                <TasksPage />
              </Suspense>
            )
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

/**
 * Where `/` lands. Everyone who can work the board lands on Tasks. A viewer
 * can't (the API refuses them), so a viewer who is a partner lands on
 * Accounts, and one who isn't is told so here: the Accounts and Documents
 * pages send a non-partner back to `/`, so redirecting them on would loop.
 */
const Home: React.FC = () => {
  const { user } = useAuthStore();
  const [partner, setPartner] = useState<boolean | null>(null);
  const viewer = user?.role === 'viewer';

  useEffect(() => {
    if (!viewer) return;
    accountsApi.access()
      .then((a) => setPartner(a.allowed))
      .catch(() => setPartner(false));
  }, [viewer]);

  if (!viewer) return <Navigate to="/tasks" replace />;
  if (partner === null) return <Loader />;
  if (partner) return <Navigate to="/accounts" replace />;
  return (
    <div className="flex items-center justify-center h-96">
      <p className="text-muted-foreground font-medium">
        This login has no pages yet. Ask an admin to change its role.
      </p>
    </div>
  );
};

const Loader = () => (
  <div className="flex items-center justify-center h-96">
    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
  </div>
);

export default App;
