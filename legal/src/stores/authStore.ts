import { create } from 'zustand';
import { PlatformUser } from '@/types';
import { authApi } from '@/services/api';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';

interface AuthStore {
  isAuthenticated: boolean;
  user: PlatformUser | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkPlatformSession: () => Promise<void>;
  clearError: () => void;
}

// Supabase keeps the session (localStorage, auto-refreshed); this store only
// holds the profile the API resolved it to.
export const useAuthStore = create<AuthStore>()((set, get) => ({
  isAuthenticated: false,
  user: null,
  // True until the stored session has been checked, so a reload doesn't
  // flash the login page.
  isLoading: true,
  error: null,

  login: async (email: string, password: string): Promise<boolean> => {
    set({ error: null });
    try {
      const { user } = await authApi.login(email, password);
      set({ isAuthenticated: true, user, error: null });
      toast.success(`Welcome back, ${user.full_name}!`);
      return true;
    } catch (error: any) {
      const message = error.response?.data?.detail || error.message || 'Login failed';
      set({ error: message, isAuthenticated: false, user: null });
      toast.error(message);
      return false;
    }
  },

  logout: async () => {
    await authApi.logout().catch(() => { /* the local session is cleared regardless */ });
    set({ isAuthenticated: false, user: null, error: null });
    toast.success('Signed out');
  },

  checkPlatformSession: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      set({ isAuthenticated: false, user: null, isLoading: false });
      return;
    }
    try {
      const user = await authApi.getMe();
      set({ isAuthenticated: true, user, error: null, isLoading: false });
    } catch (error: any) {
      // Drop the session only when the API refused it (expired, or the login
      // was deactivated). A network blip or a 5xx keeps it, so a reload once
      // the API is back signs straight in again.
      const status = error?.response?.status;
      if (status === 401 || status === 400 || status === 403) {
        await supabase.auth.signOut();
      }
      set({ isAuthenticated: false, user: null, isLoading: false });
    }
    void get;
  },

  clearError: () => set({ error: null }),
}));

// Signed out elsewhere (another tab, an expired refresh token): follow it.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && useAuthStore.getState().isAuthenticated) {
    useAuthStore.setState({ isAuthenticated: false, user: null });
  }
});
