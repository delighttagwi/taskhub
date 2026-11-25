import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

let adminClient: SupabaseClient | undefined;

export function getAdminClient() {
  if (!adminClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase server environment is not configured.');
    adminClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return adminClient;
}

export async function getCurrentProfile() {
  const cookieStore = await cookies();
  let token = cookieStore.get('app-survey-session')?.value;
  if (!token) return null;

  const supabase = getAdminClient();
  let { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError && cookieStore.get('app-survey-refresh')?.value) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (url && key) {
      const authClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const refreshToken = cookieStore.get('app-survey-refresh')!.value;
      const { data: refreshed } = await authClient.auth.refreshSession({ refresh_token: refreshToken });
      if (refreshed.session) {
        token = refreshed.session.access_token;
        cookieStore.set('app-survey-session', refreshed.session.access_token, {
          httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: refreshed.session.expires_in,
        });
        cookieStore.set('app-survey-refresh', refreshed.session.refresh_token, {
          httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
        });
        ({ data: authData, error: authError } = await supabase.auth.getUser(token));
      }
    }
  }
  if (authError || !authData.user) return null;

  let { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, role, status, level, referral_code')
    .eq('id', authData.user.id)
    .single();
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    ({ data: profile, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, role, status')
      .eq('id', authData.user.id)
      .single());
  }
  if (error || !profile || profile.status !== 'active') return null;
  return { ...profile, level: profile.level ?? 1, referral_code: profile.referral_code ?? '' };
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
