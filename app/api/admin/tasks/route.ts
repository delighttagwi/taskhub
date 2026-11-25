import { getAdminClient, getCurrentProfile, jsonError } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const admin = await getCurrentProfile();
  if (!admin || admin.role !== 'admin') return jsonError('Administrator access required.', 403);

  const form = await request.formData();
  if (String(form.get('action') ?? '') !== 'create-task') return jsonError('Unknown task action.');

  const name = String(form.get('name') ?? '').trim();
  const description = String(form.get('description') ?? '').trim();
  const instructions = String(form.get('instructions') ?? '').trim();
  const downloadUrl = String(form.get('downloadUrl') ?? '').trim();
  const reward = Number(form.get('reward'));
  const duration = Number(form.get('duration') ?? 10);
  const surveyQuestions = String(form.get('surveyQuestions') ?? '').split('\n').map((question) => question.trim()).filter(Boolean);
  const image = form.get('image');

  try {
    if (new URL(downloadUrl).protocol !== 'https:') return jsonError('Task links must use HTTPS.');
  } catch { return jsonError('Enter a valid HTTPS task link.'); }
  if (name.length < 2 || !description || !instructions || !Number.isFinite(reward) || reward <= 0 || !Number.isInteger(duration) || duration < 10) {
    return jsonError('Complete the task details with a reward and at least 10 minutes of testing.');
  }
  if (surveyQuestions.length < 1 || surveyQuestions.length > 20 || surveyQuestions.some((question) => question.length < 5 || question.length > 300)) {
    return jsonError('Add 1 to 20 survey questions, each between 5 and 300 characters.');
  }
  if (image instanceof File && image.size > 5 * 1024 * 1024) return jsonError('Task images must be 5 MB or smaller.');
  if (image instanceof File && image.size > 0 && !['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) {
    return jsonError('Task images must be PNG, JPG, or WebP.');
  }

  const db = getAdminClient();
  let imagePath: string | null = null;
  let imageUrl: string | null = null;
  if (image instanceof File && image.size > 0) {
    const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1];
    imagePath = `${admin.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await db.storage.from('task-images').upload(imagePath, Buffer.from(await image.arrayBuffer()), {
      contentType: image.type,
      upsert: false,
    });
    if (error) return jsonError('Could not upload the task image. Check that the task-images bucket migration has been run.', 500);
    imageUrl = db.storage.from('task-images').getPublicUrl(imagePath).data.publicUrl;
  }

  let { error } = await db.from('tasks').insert({
    name, description, instructions, download_url: downloadUrl, image_url: imageUrl,
    reward, min_duration_minutes: duration, survey_questions: surveyQuestions,
  });
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    ({ error } = await db.from('tasks').insert({
      name, description, instructions, download_url: downloadUrl,
      reward, min_duration_minutes: duration,
    }));
  }
  if (error) {
    if (imagePath) await db.storage.from('task-images').remove([imagePath]);
    return jsonError('Could not create the task.');
  }
  return Response.json({ ok: true });
}
