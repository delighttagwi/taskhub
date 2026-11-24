import { getAdminClient, getCurrentProfile, jsonError } from '@/lib/supabase';

export const runtime = 'nodejs';

async function getAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return null;
  return profile;
}

export async function GET() {
  const admin = await getAdmin();
  if (!admin) return jsonError('Administrator access required.', 403);
  const db = getAdminClient();
  const [users, tasks, submissions, withdrawals, settings, funding, earnings] = await Promise.all([
    db.from('profiles').select('id, full_name, email, phone, role, status, created_at, chat_permissions!chat_permissions_user_id_fkey(status)').order('created_at', { ascending: false }).limit(200),
    db.from('tasks').select('*').order('created_at', { ascending: false }),
    db.from('submissions').select('id, user_id, task_id, screenshot_path, details, survey_answers, duration_minutes, reward_amount, status, created_at, profiles!submissions_user_id_fkey(full_name, email, phone), tasks(name)').eq('status', 'pending').order('created_at', { ascending: true }),
    db.from('withdrawals').select('id, user_id, amount, payout_details, status, created_at, profiles!withdrawals_user_id_fkey(full_name, email, phone)').eq('status', 'pending').order('created_at', { ascending: true }),
    db.from('settings').select('key, value'),
    db.from('funding_ledger').select('amount, note, created_at').order('created_at', { ascending: false }).limit(50),
    db.from('transactions').select('user_id, amount').eq('kind', 'task_reward'),
  ]);
  const error = [users, tasks, submissions, withdrawals, settings, funding, earnings].find((result) => result.error)?.error;
  if (error) return jsonError('Could not load the admin dashboard.', 500);
  const reviewQueue = await Promise.all((submissions.data ?? []).map(async (submission) => {
    const { data } = await db.storage.from('proofs').createSignedUrl(submission.screenshot_path, 300);
    return { ...submission, screenshot_url: data?.signedUrl ?? null };
  }));
  const totals = new Map<string, number>();
  for (const transaction of earnings.data ?? []) totals.set(transaction.user_id, (totals.get(transaction.user_id) ?? 0) + Number(transaction.amount));
  return Response.json({ users: (users.data ?? []).filter((user) => user.role === 'user').map((user) => ({ ...user, total_earned: totals.get(user.id) ?? 0 })), tasks: tasks.data, submissions: reviewQueue, withdrawals: withdrawals.data, settings: settings.data, funding: funding.data });
}

export async function POST(request: Request) {
  const admin = await getAdmin();
  if (!admin) return jsonError('Administrator access required.', 403);
  const db = getAdminClient();
  const body = await request.json();
  const action = String(body.action ?? '');

  if (action === 'create-task') {
    const name = String(body.name ?? '').trim();
    const description = String(body.description ?? '').trim();
    const instructions = String(body.instructions ?? '').trim();
    const downloadUrl = String(body.downloadUrl ?? '').trim();
    const reward = Number(body.reward);
    const duration = Number(body.duration ?? 10);
    const surveyQuestions = Array.isArray(body.surveyQuestions)
      ? body.surveyQuestions.map((question: unknown) => String(question).trim()).filter(Boolean)
      : [];
    try {
      if (new URL(downloadUrl).protocol !== 'https:') return jsonError('Task links must use HTTPS.');
    } catch { return jsonError('Enter a valid HTTPS task link.'); }
    if (name.length < 2 || !description || !instructions || !Number.isFinite(reward) || reward <= 0 || !Number.isInteger(duration) || duration < 10) return jsonError('Complete the task details with a reward and at least 10 minutes of testing.');
    if (surveyQuestions.length < 1 || surveyQuestions.length > 20 || surveyQuestions.some((question: string) => question.length < 5 || question.length > 300)) return jsonError('Add 1 to 20 survey questions, each between 5 and 300 characters.');
    const { error } = await db.from('tasks').insert({ name, description, instructions, download_url: downloadUrl, reward, min_duration_minutes: duration, survey_questions: surveyQuestions });
    if (error) return jsonError('Could not create the task.');
    return Response.json({ ok: true });
  }

  if (action === 'review-submission') {
    const reward = body.approve === true ? Number(body.reward) : null;
    if (reward !== null && (!Number.isFinite(reward) || reward <= 0)) return jsonError('Enter a positive USDT reward to credit.');
    const { error } = await db.rpc('review_submission', {
      p_admin_id: admin.id, p_submission_id: String(body.id), p_approve: body.approve === true, p_reason: String(body.reason ?? '').trim(), p_reward_amount: reward,
    });
    if (error) return jsonError(error.message);
    return Response.json({ ok: true });
  }

  if (action === 'review-withdrawal') {
    const { error } = await db.rpc('review_withdrawal', {
      p_admin_id: admin.id, p_withdrawal_id: String(body.id), p_approve: body.approve === true, p_reason: String(body.reason ?? '').trim(),
    });
    if (error) return jsonError(error.message);
    return Response.json({ ok: true });
  }

  if (action === 'set-chat-access') {
    const userId = String(body.userId ?? '');
    const status = body.unlocked === true ? 'unlocked' : 'locked';
    const { error } = await db.from('chat_permissions').upsert({ user_id: userId, status, updated_by: admin.id }, { onConflict: 'user_id' });
    if (error) return jsonError('Could not update chat access.');
    return Response.json({ ok: true });
  }

  if (action === 'set-user-status') {
    const userId = String(body.userId ?? '');
    const status = body.suspended === true ? 'suspended' : 'active';
    const { error } = await db.from('profiles').update({ status }).eq('id', userId).neq('role', 'admin');
    if (error) return jsonError('Could not update account status.');
    return Response.json({ ok: true });
  }

  if (action === 'update-settings') {
    const reward = Number(body.reward);
    const dailyLimit = Number(body.dailyLimit);
    const minimumWithdrawal = Number(body.minimumWithdrawal);
    const pointsPerUsdt = Number(body.pointsPerUsdt);
    if (![reward, dailyLimit, minimumWithdrawal, pointsPerUsdt].every(Number.isFinite) || reward <= 0 || dailyLimit < 1 || minimumWithdrawal <= 0 || pointsPerUsdt <= 0) return jsonError('Enter positive point rewards, a daily limit, minimum withdrawal, and points-per-USDT rate.');
    const updates = [
      { key: 'reward_per_task', value: reward },
      { key: 'daily_task_limit', value: dailyLimit },
      { key: 'minimum_withdrawal', value: minimumWithdrawal },
      { key: 'points_per_usdt', value: pointsPerUsdt },
    ];
    const { error } = await db.from('settings').upsert(updates, { onConflict: 'key' });
    if (error) return jsonError('Could not update reward settings.');
    return Response.json({ ok: true });
  }

  if (action === 'record-funding') {
    const amount = Number(body.amount);
    const note = String(body.note ?? '').trim();
    const { error } = await db.rpc('record_platform_funding', { p_admin_id: admin.id, p_amount: amount, p_note: note });
    if (error) return jsonError(error.message);
    return Response.json({ ok: true });
  }

  return jsonError('Unknown admin action.');
}
