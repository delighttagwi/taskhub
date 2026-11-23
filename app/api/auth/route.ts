import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getAdminClient, jsonError } from '@/lib/supabase';

export const runtime = 'nodejs';

const signupAttempts = new Map<string, { count: number; resetAt: number }>();

function isSignupRateLimited(ip: string) {
  const now = Date.now();
  const attempt = signupAttempts.get(ip);
  if (!attempt || attempt.resetAt <= now) {
    signupAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  if (attempt.count >= 5) return true;
  attempt.count += 1;
  return false;
}

function getAuthClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase server environment is not configured.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action ?? '');
    const email = String(body.email ?? '').trim().toLowerCase();
    const phone = String(body.phone ?? '').trim();
    const password = String(body.password ?? '');
    const supabase = getAuthClient();

    if (action === 'register' || action === 'login') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError('Enter a valid email address.');
      if (password.length < 8) return jsonError('Password must be at least 8 characters long.');
      const fullName = String(body.fullName ?? '').trim();
      if (action === 'register' && fullName.length < 2) return jsonError('Enter your name to create an account.');
      if (action === 'register' && !/^\+[1-9]\d{7,14}$/.test(phone)) return jsonError('Enter your mobile number in international format, such as +263771234567.');
      if (action === 'register') {
        const ip = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
        if (isSignupRateLimited(ip)) return jsonError('Too many signup attempts. Try again in 15 minutes.', 429);
        const { error: createError } = await getAdminClient().auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName, phone },
        });
        if (createError) return jsonError(createError.message, 400);
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session) return jsonError('Could not sign in with that email and password.', 401);
      const cookieStore = await cookies();
      cookieStore.set('app-survey-session', data.session.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: data.session.expires_in,
      });
      cookieStore.set('app-survey-refresh', data.session.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
      return Response.json({ ok: true });
    }

    if (action === 'logout') {
      const cookieStore = await cookies();
      cookieStore.delete('app-survey-session');
      cookieStore.delete('app-survey-refresh');
      return Response.json({ ok: true });
    }

    return jsonError('Unknown authentication action.');
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Authentication request failed.', 500);
  }
}
