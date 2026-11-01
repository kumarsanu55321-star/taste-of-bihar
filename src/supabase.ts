import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey, {
  // This public campaign performs anonymous RPC calls; it does not create participant sessions.
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
}) : null;

export function requireSupabase() {
  if (!supabase) throw new Error('Contest registration is not configured yet. Please try again later.');
  return supabase;
}
