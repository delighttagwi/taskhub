import { getAdminClient, getCurrentProfile, jsonError } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return jsonError('Sign in to continue.', 401);
  const db = getAdminClient();
  const memberLevel = Number(profile.level ?? 1);
  await db.rpc('hide_expired_tasks');
  let tasks: any = await db.from('tasks').select('id, name, description, download_url, instructions, reward, min_duration_minutes, survey_questions, level, closes_at').eq('is_active', true).lte('level', memberLevel).or(`closes_at.is.null,closes_at.gt.${new Date().toISOString()}`).order('created_at', { ascending: false });
  if (tasks.error?.code === '42703' || tasks.error?.code === 'PGRST204') {
    tasks = await db.from('tasks').select('id, name, description, download_url, instructions, reward, min_duration_minutes, survey_questions').eq('is_active', true).order('created_at', { ascending: false });
  }
  const [submissions, wallet, transactions, permission, messages, unreadMessages, settings] = await Promise.all([
    db.from('submissions').select('id, task_id, status, reward_amount, decision_reason, created_at, tasks(name)').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(10),
    db.from('wallet_balances').select('balance').eq('user_id', profile.id).maybeSingle(),
    db.from('transactions').select('id, kind, amount, description, created_at').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(10),
    db.from('chat_permissions').select('status').eq('user_id', profile.id).maybeSingle(),
    db.from('messages').select('id, sender_id, body, image_url, read_at, created_at').eq('user_id', profile.id).order('created_at', { ascending: true }).limit(100),
    db.from('messages').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).neq('sender_id', profile.id).is('read_at', null),
    db.from('settings').select('key, value').in('key', ['minimum_withdrawal', 'points_per_usdt']),
  ]);
  let notice: any = await db.from('app_notices').select('id, message, image_url').eq('is_active', true).order('created_at', { ascending: false }).limit(1);
  if (notice.error?.code === '42P01' || notice.error?.code === 'PGRST205') notice = { data: [], error: null };
  const failed = [tasks, submissions, wallet, transactions, permission, messages, unreadMessages, settings, notice].find((result) => result.error);
  if (failed?.error) return jsonError('Could not load your dashboard.', 500);
  return Response.json({
    profile,
    tasks: tasks.data,
    submissions: submissions.data,
    balance: wallet.data?.balance ?? 0,
    transactions: transactions.data,
    chat: permission.data?.status ?? 'locked',
    unreadMessageCount: unreadMessages.count ?? 0,
    messages: messages.data,
    settings: settings.data,
    notice: notice.data?.[0] ?? null,
  });
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return jsonError('Sign in to continue.', 401);
  const db = getAdminClient();
  const form = await request.formData();
  const action = String(form.get('action') ?? '');

  if (action === 'mark-messages-read') {
    const { error } = await db.from('messages').update({ read_at: new Date().toISOString() })
      .eq('user_id', profile.id).neq('sender_id', profile.id).is('read_at', null);
    if (error) return jsonError('Could not mark messages as read.', 500);
    return Response.json({ ok: true });
  }

  if (action === 'submit-task') {
    const taskId = String(form.get('taskId') ?? '');
    const details = String(form.get('details') ?? '').trim();
    const duration = Number(form.get('duration') ?? 0);
    const proof = form.get('proof');
    const { data: task, error: taskError } = await db.from('tasks').select('id, reward, min_duration_minutes, survey_questions, closes_at').eq('id', taskId).single();
    if (taskError || !task) return jsonError('This task could not be found. Refresh and try again.', 404);
    if (task.closes_at && new Date(task.closes_at).getTime() <= Date.now()) {
      await db.from('tasks').update({ is_active: false }).eq('id', taskId);
      return jsonError('This survey is closed.', 410);
    }

    let screenshotPath: string | null = null;
    if (!(proof instanceof File) || proof.size < 1 || proof.size > 8 * 1024 * 1024) return jsonError('Upload a screenshot no larger than 8 MB.');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(proof.type)) return jsonError('Screenshot must be a PNG, JPG or WebP image.');
    if (!Number.isInteger(duration) || duration < task.min_duration_minutes) return jsonError(`This task requires at least ${task.min_duration_minutes} minutes of testing.`);
    if (details.length < 10) return jsonError('Add a few details about your testing session.');
    if (proof instanceof File && proof.size > 0) {
      const extension = proof.type === 'image/jpeg' ? 'jpg' : proof.type.split('/')[1];
      screenshotPath = `${profile.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await db.storage.from('proofs').upload(screenshotPath, Buffer.from(await proof.arrayBuffer()), { contentType: proof.type, upsert: false });
      if (uploadError) return jsonError('Screenshot upload failed. Try again.', 500);
    }
    const questions = Array.isArray(task.survey_questions) ? task.survey_questions as string[] : [];
    const surveyAnswers = questions.map((question, index) => ({
      question,
      answer: String(form.get(`survey_${index}`) ?? '').trim(),
    }));
    if (surveyAnswers.some(({ answer }) => answer.length < 2)) return jsonError('Answer each app survey question before submitting.');

    const { error } = await db.from('submissions').insert({
      user_id: profile.id, task_id: task.id, screenshot_path: screenshotPath,
      details,
      duration_minutes: duration,
      survey_answers: surveyAnswers,
      reward_amount: task.reward,
    });
    if (error) {
      if (screenshotPath) await db.storage.from('proofs').remove([screenshotPath]);
      return jsonError(error.code === '23505' ? 'You already submitted this task.' : 'Could not save your submission.');
    }
    return Response.json({ ok: true });
  }

  if (action === 'request-withdrawal') {
    const amount = Number(form.get('amount'));
    const payoutDetails = String(form.get('payoutDetails') ?? '').trim();
    if (!Number.isFinite(amount) || amount <= 0 || payoutDetails.length < 5) return jsonError('Enter a valid amount and payout details.');
    const { error } = await db.rpc('request_withdrawal', { p_user_id: profile.id, p_amount: amount, p_payout_details: payoutDetails });
    if (error) return jsonError(error.message, 400);
    return Response.json({ ok: true });
  }

  if (action === 'send-message') {
    const body = String(form.get('body') ?? '').trim();
    const image = form.get('image');
    if (!body && (!(image instanceof File) || image.size < 1)) return jsonError('Enter a message or attach an image.');
    if (body.length > 2000) return jsonError('Messages must be no more than 2,000 characters.');
    if (image instanceof File && image.size > 8 * 1024 * 1024) return jsonError('Chat images must be 8 MB or smaller.');
    if (image instanceof File && image.size > 0 && !['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) return jsonError('Chat images must be PNG, JPG or WebP.');
    const { data: access } = await db.from('chat_permissions').select('status').eq('user_id', profile.id).maybeSingle();
    if (access?.status !== 'unlocked') return jsonError('Private chat access is locked.', 403);

    let imageUrl: string | null = null;
    let imagePath: string | null = null;
    if (image instanceof File && image.size > 0) {
      const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1];
      imagePath = `${profile.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await db.storage.from('chat-images').upload(imagePath, Buffer.from(await image.arrayBuffer()), { contentType: image.type, upsert: false });
      if (uploadError) return jsonError('Could not upload the chat image. Try again.', 500);
      imageUrl = db.storage.from('chat-images').getPublicUrl(imagePath).data.publicUrl;
    }

    const { error } = await db.from('messages').insert({
      user_id: profile.id,
      sender_id: profile.id,
      body: body || null,
      image_url: imageUrl,
    });
    if (error) {
      if (imagePath) await db.storage.from('chat-images').remove([imagePath]);
      return jsonError('Could not send your message.', 500);
    }
    return Response.json({ ok: true });
  }

  return jsonError('Unknown portal action.');
}
