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
  const { data: messages, error } = await db.from('messages').select('id, user_id, sender_id, body, image_url, read_at, created_at').eq('user_id', userId).order('created_at', { ascending: true }).limit(200);
  if (error) return jsonError('Could not load this conversation.', 500);
  await db.from('messages').update({ read_at: new Date().toISOString() }).eq('user_id', userId).neq('sender_id', admin.id).is('read_at', null);
  return Response.json({ messages });
}

export async function POST(request: Request) {
  const admin = await adminProfile();
  if (!admin) return jsonError('Administrator access required.', 403);
  const form = await request.formData();
  const userId = String(form.get('userId') ?? '');
  const message = String(form.get('body') ?? '').trim();
  const image = form.get('image');
  if (String(form.get('action') ?? '') !== 'send' || !userId) return jsonError('Choose a conversation.');
  if (!message && (!(image instanceof File) || image.size < 1)) return jsonError('Enter a message or attach an image.');
  if (message.length > 2000) return jsonError('Messages must be no more than 2,000 characters.');
  if (image instanceof File && image.size > 8 * 1024 * 1024) return jsonError('Chat images must be 8 MB or smaller.');
  if (image instanceof File && image.size > 0 && !['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) return jsonError('Chat images must be PNG, JPG or WebP.');
  const db = getAdminClient();
  const { data: permission } = await db.from('chat_permissions').select('status').eq('user_id', userId).maybeSingle();
  if (permission?.status !== 'unlocked') return jsonError('This user does not have private chat access.', 403);

  let imageUrl: string | null = null;
  let imagePath: string | null = null;
  if (image instanceof File && image.size > 0) {
    const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1];
    imagePath = `${admin.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await db.storage.from('chat-images').upload(imagePath, Buffer.from(await image.arrayBuffer()), { contentType: image.type, upsert: false });
    if (uploadError) return jsonError('Could not upload the chat image. Check that the chat-images migration has been run.', 500);
    imageUrl = db.storage.from('chat-images').getPublicUrl(imagePath).data.publicUrl;
  }

  const { error } = await db.from('messages').insert({
    user_id: userId,
    sender_id: admin.id,
    body: message || null,
    image_url: imageUrl,
  });
  if (error) {
    if (imagePath) await db.storage.from('chat-images').remove([imagePath]);
    return jsonError('Could not send this message.', 500);
  }
  return Response.json({ ok: true });
}
