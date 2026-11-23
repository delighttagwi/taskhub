import { getAdminClient, getCurrentProfile, jsonError } from '@/lib/supabase';

export const runtime = 'nodejs';

async function adminProfile() {
  const profile = await getCurrentProfile();
  return profile?.role === 'admin' ? profile : null;
}

export async function GET(request: Request) {
  const admin = await adminProfile();
  if (!admin) return jsonError('Administrator access required.', 403);
  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) return jsonError('Choose a user conversation.');
  const db = getAdminClient();
  const { data: messages, error } = await db.from('messages').select('id, user_id, sender_id, body, read_at, created_at').eq('user_id', userId).order('created_at', { ascending: true }).limit(200);
  if (error) return jsonError('Could not load this conversation.', 500);
  await db.from('messages').update({ read_at: new Date().toISOString() }).eq('user_id', userId).neq('sender_id', admin.id).is('read_at', null);
  return Response.json({ messages });
}

export async function POST(request: Request) {
  const admin = await adminProfile();
  if (!admin) return jsonError('Administrator access required.', 403);
  const body = await request.json();
  const userId = String(body.userId ?? '');
  const message = String(body.body ?? '').trim();
  if (body.action !== 'send' || !userId || !message || message.length > 2000) return jsonError('Choose a conversation and enter a message.');
  const db = getAdminClient();
  const { data: permission } = await db.from('chat_permissions').select('status').eq('user_id', userId).maybeSingle();
  if (permission?.status !== 'unlocked') return jsonError('This user does not have private chat access.', 403);
  const { error } = await db.from('messages').insert({ user_id: userId, sender_id: admin.id, body: message });
  if (error) return jsonError('Could not send this message.', 500);
  return Response.json({ ok: true });
}
