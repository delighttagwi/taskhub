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

  const profileFields = 'id, full_name, email, phone, role, status, level, referral_code, referred_by, created_at, chat_permissions!chat_permissions_user_id_fkey(status)';
  const legacyProfileFields = 'id, full_name, email, phone, role, status, created_at, chat_permissions!chat_permissions_user_id_fkey(status)';
  const allUsers: any[] = [];
  let userError: any = null;
  for (let offset = 0; ; offset += 1000) {
    let batch: any = await db.from('profiles').select(profileFields).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 999);
    if (batch.error?.code === '42703' || batch.error?.code === 'PGRST204') {
      batch = await db.from('profiles').select(legacyProfileFields).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 999);
    }
    if (batch.error) {
      userError = batch.error;
      break;
    }
    allUsers.push(...(batch.data ?? []));
    if ((batch.data ?? []).length < 1000) break;
  }
  const users = { data: allUsers, error: userError };

  const [tasks, submissions, withdrawals, settings, funding] = await Promise.all([
    db.from('tasks').select('*').order('created_at', { ascending: false }),
    db.from('submissions').select('id, user_id, task_id, screenshot_path, details, duration_minutes, survey_answers, reward_amount, status, created_at, profiles!submissions_user_id_fkey(full_name, email, phone), tasks(name)').eq('status', 'pending').order('created_at', { ascending: true }),
    db.from('withdrawals').select('id, user_id, amount, payout_details, status, created_at, profiles!withdrawals_user_id_fkey(full_name, email, phone)').eq('status', 'pending').order('created_at', { ascending: true }),
    db.from('settings').select('key, value'),
    db.from('funding_ledger').select('amount, note, created_at').order('created_at', { ascending: false }).limit(50),
  ]);

  const transactions: any[] = [];
  let transactionError: any = null;
  for (let offset = 0; ; offset += 1000) {
    const batch = await db.from('transactions').select('id, user_id, amount, kind, created_at').order('id', { ascending: true }).range(offset, offset + 999);
    if (batch.error) {
      transactionError = batch.error;
      break;
    }
    transactions.push(...(batch.data ?? []));
    if ((batch.data ?? []).length < 1000) break;
  }

  let notices: any = await db.from('app_notices').select('id, message, image_url, is_active, created_at').eq('is_active', true).order('created_at', { ascending: false }).limit(1);
  if (notices.error?.code === '42P01' || notices.error?.code === 'PGRST205') notices = { data: [] };

  const error = [users, tasks, submissions, withdrawals, settings, funding, { error: transactionError }, notices].find((result) => result.error)?.error;
  if (error) return jsonError('Could not load the admin dashboard.', 500);
  const reviewQueue = await Promise.all((submissions.data ?? []).map(async (submission: any) => {
    if (!submission.screenshot_path) return { ...submission, screenshot_url: null };
    const { data } = await db.storage.from('proofs').createSignedUrl(submission.screenshot_path, 300);
    return { ...submission, screenshot_url: data?.signedUrl ?? null };
  }));
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const totals = new Map<string, { balance: number; earned: number; earnedToday: number }>();
  for (const transaction of transactions) {
    const account = totals.get(transaction.user_id) ?? { balance: 0, earned: 0, earnedToday: 0 };
    const amount = Number(transaction.amount);
    account.balance += amount;
    if (transaction.kind === 'task_reward') {
      account.earned += amount;
      if (new Date(transaction.created_at).getTime() >= todayStart.getTime()) account.earnedToday += amount;
    }
    totals.set(transaction.user_id, account);
  }
  return Response.json({ users: (users.data ?? []).filter((user: any) => user.role === 'user').map((user: any) => {
    const account = totals.get(user.id) ?? { balance: 0, earned: 0, earnedToday: 0 };
    return { ...user, level: user.level ?? 1, referral_code: user.referral_code ?? '', total_earned: account.earned, total_points: account.balance, points_today: account.earnedToday };
  }), tasks: tasks.data, submissions: reviewQueue, withdrawals: withdrawals.data, settings: settings.data, funding: funding.data, notices: notices.data });
}

export async function POST(request: Request) {
  const admin = await getAdmin();
  if (!admin) return jsonError('Administrator access required.', 403);
  const db = getAdminClient();

  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
    const form = await request.formData();
    if (String(form.get('action') ?? '') !== 'publish-notice') return jsonError('Unknown notice action.');
    const message = String(form.get('message') ?? '').trim();
    const image = form.get('image');
    if (image instanceof File && image.size > 8 * 1024 * 1024) return jsonError('Notice images must be 8 MB or smaller.');
    if (image instanceof File && image.size > 0 && !['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) {
      return jsonError('Notice images must be PNG, JPG or WebP.');
    }

    const { data: currentNotice, error: currentNoticeError } = await db.from('app_notices')
      .select('image_url').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (currentNoticeError) return jsonError('Could not load the current notice.');

    let imagePath: string | null = null;
    let imageUrl: string | null = currentNotice?.image_url ?? null;
    if (image instanceof File && image.size > 0) {
      const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1];
      imagePath = `${admin.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await db.storage.from('notice-images').upload(imagePath, Buffer.from(await image.arrayBuffer()), {
        contentType: image.type,
        upsert: false,
      });
      if (uploadError) return jsonError('Could not upload the notice image. Check that the notice-images bucket migration has been run.', 500);
      imageUrl = db.storage.from('notice-images').getPublicUrl(imagePath).data.publicUrl;
    }
    if (!message && !imageUrl) {
      if (imagePath) await db.storage.from('notice-images').remove([imagePath]);
      return jsonError('Add a notice message or upload an image.');
    }

    const { data: publishedNotice, error: insertError } = await db.from('app_notices').insert({
      message: message || null,
      image_url: imageUrl,
      is_active: true,
      created_by: admin.id,
    }).select('id').single();
    if (insertError) {
      if (imagePath) await db.storage.from('notice-images').remove([imagePath]);
      return jsonError('Could not publish the notice.');
    }
    const { error: deactivateError } = await db.from('app_notices').update({ is_active: false })
      .eq('is_active', true).neq('id', publishedNotice.id);
    if (deactivateError) return jsonError('The notice was published, but an older notice could not be archived.');
    return Response.json({ ok: true });
  }

  const body = await request.json();
  const action = String(body.action ?? '');

  if (action === 'toggle-task') {
    const taskId = String(body.id ?? '');
    if (!taskId || typeof body.isActive !== 'boolean') return jsonError('Choose a task and a valid publish state.');
    const { error } = await db.from('tasks').update({ is_active: body.isActive }).eq('id', taskId);
    if (error) return jsonError('Could not update task publish status.');
    return Response.json({ ok: true });
  }

  if (action === 'create-task') {
    const name = String(body.name ?? '').trim();
    const description = String(body.description ?? '').trim();
    const instructions = String(body.instructions ?? '').trim();
    const downloadUrl = String(body.downloadUrl ?? '').trim();
    const taskType = String(body.taskType ?? 'app') === 'survey' ? 'survey' : 'app';
    const reward = Number(body.reward);
    const duration = Number(body.duration ?? 10);
    const surveyQuestions = Array.isArray(body.surveyQuestions)
      ? body.surveyQuestions.map((question: unknown) => String(question).trim()).filter(Boolean)
      : [];
    const level = Math.trunc(Number(body.level ?? 1));
    const closesAt = String(body.closesAt ?? '').trim();
    try {
      if (taskType === 'app') {
        if (new URL(downloadUrl).protocol !== 'https:') return jsonError('Task links must use HTTPS.');
      }
    } catch { return jsonError('Enter a valid HTTPS task link.'); }
    if (taskType === 'app' && (!instructions || !Number.isInteger(duration) || duration < 10)) return jsonError('App tasks require testing instructions and at least 10 minutes.');
    if (name.length < 2 || !description || !Number.isFinite(reward) || reward <= 0) return jsonError('Complete the task details with a positive USDT reward.');
    if (surveyQuestions.length < 1 || surveyQuestions.length > 20 || surveyQuestions.some((question: string) => question.length < 5 || question.length > 300)) return jsonError('Add 1 to 20 survey questions, each between 5 and 300 characters.');
    if (level < 1 || level > 5) return jsonError('Choose a task level from 1 to 5.');
    if (closesAt) {
      const closeDate = new Date(closesAt);
      if (Number.isNaN(closeDate.getTime()) || closeDate.getTime() <= Date.now()) return jsonError('Choose a valid future close date and time.');
    }
    let { error } = await db.from('tasks').insert({
      name, description, task_type: taskType,
      instructions: taskType === 'app' ? instructions : null,
      download_url: taskType === 'app' ? downloadUrl : null,
      reward, min_duration_minutes: taskType === 'app' ? duration : 0,
      survey_questions: surveyQuestions,
      level,
      closes_at: closesAt ? new Date(closesAt).toISOString() : null,
    });
    if (error?.code === '42703' || error?.code === 'PGRST204') {
      ({ error } = await db.from('tasks').insert({
        name, description, instructions, download_url: downloadUrl,
        reward, min_duration_minutes: duration,
        survey_questions: surveyQuestions,
      }));
    }
    if (error) return jsonError('Could not create the task.');
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
    if (![reward, dailyLimit, minimumWithdrawal].every(Number.isFinite) || reward <= 0 || dailyLimit < 1 || minimumWithdrawal < 0) return jsonError('Enter positive task rewards, a daily limit, and a withdrawal minimum of zero or more.');
    const updates = [
      { key: 'reward_per_task', value: reward },
      { key: 'daily_task_limit', value: dailyLimit },
      { key: 'minimum_withdrawal', value: minimumWithdrawal },
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

  if (action === 'upgrade-user-level') {
    const userId = String(body.userId ?? '');
    const level = Number(body.level);
    if (!userId || level < 1 || level > 5) return jsonError('Choose a user and Level 1 to 5.');
    const { error } = await db.rpc('upgrade_user_level', { p_admin_id: admin.id, p_user_id: userId, p_level: level });
    if (error) return jsonError(error.message);
    return Response.json({ ok: true });
  }

  if (action === 'update-referral-settings') {
    const referralReward = Number(body.referralReward);
    const level2 = Number(body.level2Reward);
    const level3 = Number(body.level3Reward);
    const level4 = Number(body.level4Reward);
    const level5 = Number(body.level5Reward);
    const values = [referralReward, level2, level3, level4, level5];
    if (!values.every((value) => Number.isFinite(value) && value >= 0)) return jsonError('Referral rewards must be zero or positive.');
    const updates = [
      { key: 'referral_signup_reward', value: referralReward },
      { key: 'level_2_upgrade_reward', value: level2 },
      { key: 'level_3_upgrade_reward', value: level3 },
      { key: 'level_4_upgrade_reward', value: level4 },
      { key: 'level_5_upgrade_reward', value: level5 },
    ];
    const { error } = await db.from('settings').upsert(updates, { onConflict: 'key' });
    if (error) return jsonError('Could not update referral rewards.');
    return Response.json({ ok: true });
  }

  if (action === 'remove-notice') {
    const { error } = await db.from('app_notices').update({ is_active: false }).eq('is_active', true);
    if (error) return jsonError('Could not remove the notice.');
    return Response.json({ ok: true });
  }

  return jsonError('Unknown action.');
}
