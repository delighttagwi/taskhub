import { getAdminClient, getCurrentProfile, jsonError } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return jsonError('Sign in to continue.', 401);
  if (profile.role !== 'admin') {
    const db = getAdminClient();
    const { data } = await db.from('chat_permissions').select('status').eq('user_id', profile.id).maybeSingle();
    if (data?.status !== 'unlocked') return jsonError('Private chat access is locked.', 403);
  }

  const db = getAdminClient();
  const encoder = new TextEncoder();
  let channel: ReturnType<typeof db.channel> | undefined;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      channel = db.channel(`app-survey-chat-${profile.id}-${crypto.randomUUID()}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'messages',
          ...(profile.role === 'admin' ? {} : { filter: `user_id=eq.${profile.id}` }),
        }, () => controller.enqueue(encoder.encode('event: message\ndata: update\n\n')))
        .subscribe();
      keepAlive = setInterval(() => controller.enqueue(encoder.encode(': keep-alive\n\n')), 20000);
      controller.enqueue(encoder.encode('data: connected\n\n'));
    },
    async cancel() {
      if (keepAlive) clearInterval(keepAlive);
      if (channel) await db.removeChannel(channel);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
