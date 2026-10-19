import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Recovery links arrive with the session in the URL.
    detectSessionInUrl: true,
  },
});
