import { getAdminClient, getCurrentProfile, jsonError } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return jsonError('Sign in to continue.', 401);
  const db = getAdminClient();
  const [tasks, submissions, wallet, transactions, permission, messages, settings] = await Promise.all([
    db.from('tasks').select('id, name, description, download_url, instructions, reward, min_duration_minutes, survey_questions').eq('is_active', true).order('created_at', { ascending: false }),
    db.from('submissions').select('id, task_id, status, reward_amount, decision_reason, created_at, tasks(name)').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(10),
    db.from('wallet_balances').select('balance').eq('user_id', profile.id).maybeSingle(),
    db.from('transactions').select('id, kind, amount, description, created_at').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(10),
    db.from('chat_permissions').select('status').eq('user_id', profile.id).maybeSingle(),
    db.from('messages').select('id, sender_id, body, read_at, created_at').eq('user_id', profile.id).order('created_at', { ascending: true }).limit(100),
    db.from('settings').select('key, value').in('key', ['minimum_withdrawal', 'points_per_usdt']),
  ]);
  const failed = [tasks, submissions, wallet, transactions, permission, messages, settings].find((result) => result.error);
  if (failed?.error) return jsonError('Could not load your dashboard.', 500);
  if (permission.data?.status === 'unlocked') {
    await db.from('messages').update({ read_at: new Date().toISOString() })
      .eq('user_id', profile.id).neq('sender_id', profile.id).is('read_at', null);
  }
  return Response.json({
    profile,
    tasks: tasks.data,
    submissions: submissions.data,
    balance: wallet.data?.balance ?? 0,
    transactions: transactions.data,
    chat: permission.data?.status ?? 'locked',
    messages: messages.data,
    settings: settings.data,
  });
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return jsonError('Sign in to continue.', 401);
  const db = getAdminClient();
  const form = await request.formData();
  const action = String(form.get('action') ?? '');

  if (action === 'submit-task') {
    const taskId = String(form.get('taskId') ?? '');
    const details = String(form.get('details') ?? '').trim();
    const duration = Number(form.get('duration') ?? 0);
    const proof = form.get('proof');
    if (!(proof instanceof File) || proof.size < 1 || proof.size > 8 * 1024 * 1024) return jsonError('Upload a screenshot no larger than 8 MB.');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(proof.type)) return jsonError('Screenshot must be a PNG, JPG or WebP image.');
    const { data: task, error: taskError } = await db.from('tasks').select('id, reward, min_duration_minutes, survey_questions').eq('id', taskId).eq('is_active', true).single();
    if (taskError || !task) return jsonError('This task is no longer available.', 404);
    if (duration < task.min_duration_minutes) return jsonError(`This task requires at least ${task.min_duration_minutes} minutes of testing.`);
    if (details.length < 10) return jsonError('Add a few details about your testing session.');
    const questions = Array.isArray(task.survey_questions) ? task.survey_questions as string[] : [];
    const surveyAnswers = questions.map((question, index) => ({
      question,
      answer: String(form.get(`survey_${index}`) ?? '').trim(),
    }));
    if (surveyAnswers.some(({ answer }) => answer.length < 2)) return jsonError('Answer each app survey question before submitting.');

    const extension = proof.type === 'image/jpeg' ? 'jpg' : proof.type.split('/')[1];
    const path = `${profile.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await db.storage.from('proofs').upload(path, Buffer.from(await proof.arrayBuffer()), { contentType: proof.type, upsert: false });
    if (uploadError) return jsonError('Screenshot upload failed. Try again.', 500);
    const { error } = await db.from('submissions').insert({
      user_id: profile.id, task_id: task.id, screenshot_path: path, details,
      duration_minutes: duration, reward_amount: task.reward, survey_answers: surveyAnswers,
    });
    if (error) {
      await db.storage.from('proofs').remove([path]);
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
    if (!body || body.length > 2000) return jsonError('Messages must be between 1 and 2,000 characters.');
    const { data: access } = await db.from('chat_permissions').select('status').eq('user_id', profile.id).maybeSingle();
    if (access?.status !== 'unlocked') return jsonError('Private chat access is locked.', 403);
    const { error } = await db.from('messages').insert({ user_id: profile.id, sender_id: profile.id, body });
    if (error) return jsonError('Could not send your message.', 500);
    return Response.json({ ok: true });
  }

  return jsonError('Unknown portal action.');
}
