'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import PwaInstallButton from './PwaInstallButton';

type Profile = { id: string; full_name: string; email: string; phone: string; role: string; status: string; level?: number; referral_code?: string };
type Task = { id: string; name: string; description: string; download_url?: string | null; image_url?: string | null; instructions?: string | null; task_type?: 'app' | 'survey'; survey_questions: string[]; reward: number; min_duration_minutes: number; is_active?: boolean; level?: number; closes_at?: string | null };
type Portal = {
  profile: Profile; tasks: Task[]; submissions: any[]; balance: number; transactions: any[];
  chat: string; messages: any[]; unreadMessageCount: number; settings: { key: string; value: number }[]; notice?: { id: string; message?: string | null; image_url?: string | null } | null;
};
type AdminData = { users: any[]; tasks: Task[]; submissions: any[]; withdrawals: any[]; settings: { key: string; value: number }[]; funding: any[]; notices?: any[] };
type Tab = 'overview' | 'tasks' | 'wallet' | 'history' | 'chat' | 'profile' | 'users' | 'reviews' | 'admin-tasks' | 'daily-points' | 'settings';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Something went wrong.');
  return result as T;
}

const points = (amount: number) => `USDT ${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usdt = (amount: number) => `USDT ${Number(amount || 0).toFixed(2)}`;

export default function Home() {
  const [portal, setPortal] = useState<Portal | null>(null);
  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [selectedChatUser, setSelectedChatUser] = useState<any>(null);
  const [adminMessages, setAdminMessages] = useState<any[]>([]);
  const [reviewRewards, setReviewRewards] = useState<Record<string, string>>({});
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const data = await request<Portal>('/api/portal');
      setPortal(data);
      setError('');
      if (data.profile.role === 'admin') setAdminData(await request<AdminData>('/api/admin'));
    } catch (issue) {
      setPortal(null);
      if (issue instanceof Error && issue.message !== 'Sign in to continue.') setError(issue.message);
    }
  }

  async function markChatMessagesRead() {
    const form = new FormData();
    form.set('action', 'mark-messages-read');
    await request('/api/portal', { method: 'POST', body: form });
    setPortal((current) => current ? { ...current, unreadMessageCount: 0 } : current);
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (tab !== 'chat' || portal?.profile.role === 'admin') return;
    void markChatMessagesRead().catch((issue) => setError(issue instanceof Error ? issue.message : 'Could not mark messages as read.'));
  }, [tab, portal?.profile.id]);

  useEffect(() => {
    if (!portal) return;
    const stream = new EventSource('/api/chat/events');
    stream.addEventListener('message', () => { if (tab === 'chat' && portal.profile.role !== 'admin') void markChatMessagesRead().then(() => refresh()); else void refresh(); if (selectedChatUser) void loadAdminChat(selectedChatUser); });
    return () => stream.close();
  }, [portal?.profile.id, selectedChatUser?.id, tab]);

  async function loadAdminChat(user: any) {
    setSelectedChatUser(user);
    try {
      const result = await request<{ messages: any[] }>(`/api/admin/chat?userId=${encodeURIComponent(user.id)}`);
      setAdminMessages(result.messages);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Could not load conversation.'); }
  }

  async function sendAdminMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChatUser) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    values.set('action', 'send');
    values.set('userId', selectedChatUser.id);
    try {
      await request('/api/admin/chat', { method: 'POST', body: values });
      form.reset();
      await loadAdminChat(selectedChatUser);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Could not send message.'); }
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const values = new FormData(event.currentTarget);
    try {
      await request('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: authMode, email: values.get('email'), phone: values.get('phone'), password: values.get('password'), fullName: values.get('fullName'), referralCode: values.get('referralCode') }) });
      await refresh();
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    await request('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
    setPortal(null); setAdminData(null); setTab('overview'); setNotice('You have signed out.');
  }

  async function adminAction(payload: Record<string, unknown>) {
    setBusy(true); setError(''); setNotice('');
    const successMessage = payload.action === 'review-submission'
      ? payload.approve === true ? 'Submission approved; USDT credited to wallet.' : 'Submission rejected.'
      : payload.action === 'review-withdrawal'
        ? payload.approve === true ? 'USDT withdrawal approved.' : 'Withdrawal rejected; USDT returned.'
        : 'Changes saved.';
    try { await request('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); await refresh(); setNotice(successMessage); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Could not save changes.'); }
    finally { setBusy(false); }
  }

  async function publishNotice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const values = new FormData(event.currentTarget);
    values.set('action', 'publish-notice');
    try {
      await request('/api/admin', { method: 'POST', body: values });
      await refresh();
      setNotice('Announcement published and visible in the dashboard.');
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Could not publish the announcement.'); }
    finally { setBusy(false); }
  }

  async function submitForm(event: FormEvent<HTMLFormElement>, endpoint: string, success: string) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const form = event.currentTarget;
      await request(endpoint, { method: 'POST', body: new FormData(form) });
      form.reset(); await refresh(); setNotice(success);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Could not save this request.'); }
    finally { setBusy(false); }
  }

  if (!portal) return <main className="public-shell">
    <header className="public-nav"><a className="brand" href="#home"><span className="brand-mark">AS</span><span>APP SURVEY<small>INDEPENDENT APP TESTING</small></span></a><div className="public-nav-actions"><PwaInstallButton /><span className="online"><i /> ONLINE</span></div></header>
    <section className="hero" id="home"><div className="hero-copy"><span className="eyebrow">A better way to try what is next</span><h1>Test apps.<br /><em>Earn rewards.</em></h1><p>Discover new apps, share useful feedback, and earn verified rewards for completed testing tasks.</p><div className="hero-actions"><a className="button primary" href="#join">Create your account <span>↗</span></a><a className="text-link" href="#how">How it works <span>↓</span></a></div><div className="trust-note"><span className="checkmark">✓</span> Free registration. No deposit to earn.</div></div><div className="hero-art" aria-label="App testing task preview"><div className="art-top"><span>YOUR NEXT TEST</span><span className="live-dot" /></div><div className="art-icon">a<span>.</span></div><p className="art-label">Task 024 / Mobile apps</p><h2>Everyday, made easier.</h2><p className="art-desc">Explore a new productivity app and share what you think.</p><div className="art-bottom"><span><b>10 min</b><small>TEST TIME</small></span><span><b>50 pts</b><small>REWARD</small></span><span className="art-arrow">↗</span></div><div className="art-stamp">VERIFIED<br />TASK</div></div></section>
    <section className="how-strip" id="how"><div><span className="step-no">01</span><b>Choose a task</b><small>Find an app worth exploring.</small></div><div><span className="step-no">02</span><b>Test & share</b><small>Follow the brief, send a screenshot.</small></div><div><span className="step-no">03</span><b>Get rewarded</b><small>Approved rewards go to your wallet.</small></div></section>
    <section className="join-section" id="join"><div className="join-copy"><span className="eyebrow">Your next useful discovery</span><h2>Make your curiosity<br />count.</h2><p>Join a community helping app makers build better products. You only earn when a real testing task is completed and approved.</p><div className="join-foot"><span>01 / 03</span><span>Free to join · English</span></div></div><form className="auth-panel" onSubmit={handleAuth}><div className="auth-heading"><span className="eyebrow">Get started</span><h3>{authMode === 'register' ? 'Create your account' : 'Welcome back'}</h3><p>{authMode === 'register' ? 'Sign up with email and password. Your mobile number stays on your profile.' : 'Sign in with your email and password.'}</p></div>
      <div className="auth-toggle"><button type="button" className={authMode === 'register' ? 'selected' : ''} onClick={() => { setAuthMode('register'); setError(''); }}>Create account</button><button type="button" className={authMode === 'login' ? 'selected' : ''} onClick={() => { setAuthMode('login'); setError(''); }}>Sign in</button></div>
      {authMode === 'register' && <label>Full name<input name="fullName" autoComplete="name" placeholder="Your name" required minLength={2} /></label>}
      <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label>
      {authMode === 'register' && <label>Mobile number<input name="phone" type="tel" autoComplete="tel" placeholder="+263 771 234 567" required /><small>Kept as your contact number; use international format.</small></label>}
      <label>Password<input name="password" type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} minLength={8} placeholder="At least 8 characters" required /></label>
      {authMode === 'register' && <label>Referral code <span className="optional-label">(optional)</span><input name="referralCode" placeholder="AS-XXXXXXXX" /></label>}
      {(error || notice) && <p className={error ? 'form-message error' : 'form-message'}>{error || notice}</p>}
      <button className="button primary full" disabled={busy}>{busy ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Sign in'} <span>↗</span></button>
      <p className="legal-note">By continuing, you agree to participate honestly and follow each task’s disclosed terms.</p>
    </form></section><footer className="public-footer"><span>APP SURVEY <small>© 2026</small></span><span>Test thoughtfully. Earn transparently.</span><a href="#home">Back to top ↑</a></footer>
  </main>;

  const isAdmin = portal.profile.role === 'admin';
  const nav: { key: Tab; label: string; icon: string }[] = isAdmin ? [
    { key: 'overview', label: 'Overview', icon: '◫' }, { key: 'users', label: 'People', icon: '◎' }, { key: 'admin-tasks', label: 'Tasks', icon: '▤' }, { key: 'reviews', label: 'Reviews', icon: '✓' }, { key: 'daily-points', label: 'Daily points', icon: '₮' }, { key: 'wallet', label: 'Withdrawals', icon: '↗' }, { key: 'chat', label: 'Private chat', icon: '✳' }, { key: 'settings', label: 'Rewards', icon: '⚙' },
  ] : [
    { key: 'overview', label: 'Overview', icon: '◫' }, { key: 'tasks', label: 'Explore tasks', icon: '▤' }, { key: 'wallet', label: 'Wallet', icon: '₮' }, { key: 'history', label: 'History', icon: '◷' }, ...(portal.chat === 'unlocked' ? [{ key: 'chat' as Tab, label: 'Admin chat', icon: '✳' }] : []), { key: 'profile', label: 'Profile', icon: '◎' },
  ];
  const pageTitle = nav.find((item) => item.key === tab)?.label ?? 'Overview';
  const settings = Object.fromEntries([...(adminData?.settings ?? []), ...(portal.settings ?? [])].map((item) => [item.key, item.value]));
  const totalPoints = (adminData?.users ?? []).reduce((sum, user) => sum + Number(user.total_points ?? 0), 0);
  const pointsEarnedToday = (adminData?.users ?? []).reduce((sum, user) => sum + Number(user.points_today ?? 0), 0);
  const pointsPerUsdt = Number(settings.points_per_usdt ?? 0);

  return <div className="app-shell"><aside className="sidebar"><a className="brand side-brand" href="#dashboard"><span className="brand-mark">AS</span><span>APP SURVEY<small>{isAdmin ? 'CONTROL PANEL' : 'TESTING COMMUNITY'}</small></span></a><div className="side-caption">{isAdmin ? 'ADMINISTRATION' : 'WORKSPACE'}</div><nav className="side-nav">{nav.map((item) => <button key={item.key} className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}><span className="nav-icon">{item.icon}</span>{item.label}{item.key === 'reviews' && !!adminData?.submissions.length && <i className="nav-count">{adminData.submissions.length}</i>}{item.key === 'chat' && !isAdmin && portal.unreadMessageCount > 0 && <span className="nav-count unread-count" aria-label={`${portal.unreadMessageCount} unread messages`}>{portal.unreadMessageCount}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="help-box"><span className="help-icon">?</span><b>Need a hand?</b><small>{portal.chat === 'unlocked' ? 'Your admin chat is ready.' : 'Reach out through your account.'}</small></div><button className="profile-mini" onClick={() => setTab(isAdmin ? 'settings' : 'profile')}><span className="avatar">{portal.profile.full_name?.slice(0, 1).toUpperCase() || 'U'}</span><span><b>{portal.profile.full_name}</b><small>{isAdmin ? 'Administrator' : 'Verified account'}</small></span><span className="dots">···</span></button></div></aside>
    <main className="workspace"><header className="topbar"><div><span className="breadcrumb">{isAdmin ? 'APP SURVEY ADMIN' : 'APP SURVEY'} <span>/</span> {pageTitle}</span><h1>{tab === 'overview' ? isAdmin ? 'Control panel' : 'My dashboard' : pageTitle}</h1></div><div className="top-actions"><span className="status-chip"><i /> {portal.profile.status === 'active' ? 'Account active' : portal.profile.status}</span><PwaInstallButton /><button className="icon-button" title="Refresh dashboard" onClick={() => void refresh()}>↻</button><button className="logout-button" onClick={() => void logout()}>Sign out <span>↗</span></button></div></header>
      {(error || notice) && <div className={error ? 'toast error' : 'toast'}>{error || notice}<button onClick={() => { setError(''); setNotice(''); }}>×</button></div>}
      <div className="content">
        {portal.notice && <div className="section-block level-banner" role="status" aria-live="polite">{portal.notice.message && <p>{portal.notice.message}</p>}{portal.notice.image_url && <img src={portal.notice.image_url} alt="Announcement" />}</div>}
        {!isAdmin && tab === 'overview' && <><div className="welcome-row"><div><span className="eyebrow">LEVEL {portal.profile.level ?? 1} MEMBER</span><h2>Good to see you, {portal.profile.full_name.split(' ')[0]}.</h2><p>Referral code: <b>{portal.profile.referral_code || 'Pending migration'}</b></p></div><button className="button dark" onClick={() => setTab('tasks')}>Explore tasks <span>↗</span></button></div><section className="metrics"><Metric label="Available USDT" value={points(portal.balance)} detail="Ready to withdraw" accent /><Metric label="Total USDT earned" value={points(portal.transactions.filter((item) => item.kind === 'task_reward').reduce((sum, item) => sum + Number(item.amount), 0))} detail="From approved tasks" /><Metric label="Pending review" value={String(portal.submissions.filter((item) => item.status === 'pending').length).padStart(2, '0')} detail="Submissions in progress" /><Metric label="Open tasks" value={String(portal.tasks.length).padStart(2, '0')} detail="Ready when you are" /></section><section className="overview-grid"><div className="section-block"><SectionHeading title="Recent activity" action="See history" onAction={() => setTab('history')} />{portal.transactions.length ? <ActivityList items={portal.transactions.slice(0, 4)} /> : <EmptyState title="Your activity starts here" copy="Finish a testing task to see your first reward." />}</div><div className="section-block task-highlight"><SectionHeading title="Picked for you" action="All tasks" onAction={() => setTab('tasks')} />{portal.tasks.slice(0, 2).map((task) => <TaskCompact key={task.id} task={task} onOpen={() => setTab('tasks')} />)}{!portal.tasks.length && <EmptyState title="No open tasks right now" copy="Check back soon for new apps to test." />}</div></section></>}
        {!isAdmin && tab === 'tasks' && <><div className="page-intro"><span className="eyebrow">A fresh set to explore</span><h2>Available testing tasks</h2><p>Download and test the app, answer its survey, and submit a screenshot. Rewards are credited after admin approval.</p></div><div className="task-list">{portal.tasks.map((task, index) => <article className="task-card" key={task.id}><div className="task-number">{String(index + 1).padStart(2, '0')}</div><div className="task-main"><div className="task-meta"><span>APP TESTING</span><span>{task.min_duration_minutes} MIN</span></div><h3>{task.name}</h3><p>{task.description}</p>
          {task.task_type !== 'survey' && task.download_url ? <a className="download-link" href={task.download_url} target="_blank" rel="noreferrer">Open app link ↗</a> : null}
          <details className="submission-details"><summary>Complete app survey <span>＋</span></summary><p className="instructions">{task.instructions}</p><form className="submit-form" onSubmit={(event) => submitForm(event, '/api/portal', 'Survey and task proof submitted for review.')}><input type="hidden" name="action" value="submit-task" /><input type="hidden" name="taskId" value={task.id} />{(task.survey_questions ?? []).map((question, questionIndex) => <label className="survey-question" key={`${task.id}-${questionIndex}`}>{question}<textarea name={`survey_${questionIndex}`} minLength={2} required placeholder="Your answer" /></label>)}<label>Testing time (minutes)<input type="number" name="duration" min={task.min_duration_minutes} defaultValue={task.min_duration_minutes} required /></label><label>What did you test?<textarea name="details" minLength={10} required placeholder="Share what you explored and noticed…" /></label><label>Screenshot proof<input type="file" name="proof" accept="image/png,image/jpeg,image/webp" required /><small>PNG, JPG or WebP · up to 8 MB</small></label><button className="button dark" disabled={busy}>Send survey for review <span>↗</span></button></form></details></div><div className="task-reward"><span>REWARD</span><b>{points(task.reward)}</b></div></article>)}{!portal.tasks.length && <EmptyState title="No tasks available" copy="There are no active app tests right now. Please check back soon." />}</div></>}
        {!isAdmin && tab === 'wallet' && <><div className="wallet-hero"><div><span className="eyebrow">Your USDT balance, clearly tracked</span><h2>{points(portal.balance)}</h2><p>Available USDT</p></div><div className="wallet-note"><span className="checkmark">✓</span> Rewards are added after a submission is approved.</div></div><div className="section-block wallet-section"><SectionHeading title="Request a withdrawal" /><p className="subtle">Minimum cash-out: {usdt(Number(settings.minimum_withdrawal ?? 200))}. Admin approval is required.</p><form className="withdraw-form" onSubmit={(event) => submitForm(event, '/api/portal', 'Withdrawal request sent for approval.')}><input type="hidden" name="action" value="request-withdrawal" /><label>Amount (USDT)<input type="number" name="amount" min={Number(settings.minimum_withdrawal ?? 200)} step="0.01" max={portal.balance} required /></label><label>USDT wallet address or payout details<input name="payoutDetails" minLength={5} placeholder="USDT wallet address" required /></label><button className="button dark" disabled={busy}>Request withdrawal <span>↗</span></button></form></div><div className="section-block"><SectionHeading title="Latest transactions" action="Full history" onAction={() => setTab('history')} /><ActivityList items={portal.transactions.slice(0, 6)} /></div></>}
        {!isAdmin && tab === 'history' && <><div className="page-intro"><span className="eyebrow">Your account ledger</span><h2>Activity history</h2><p>Rewards and withdrawal activity from your account.</p></div><div className="table-wrap"><table><thead><tr><th>ACTIVITY</th><th>DATE</th><th>STATUS</th><th className="right">AMOUNT</th></tr></thead><tbody>{portal.transactions.map((item) => <tr key={item.id}><td><b>{item.description || (item.kind === 'task_reward' ? 'Task reward' : 'Wallet activity')}</b><small>{item.kind.replaceAll('_', ' ')}</small></td><td>{new Date(item.created_at).toLocaleDateString()}</td><td><Status value="approved" /></td><td className="right amount">{points(item.amount)}</td></tr>)}</tbody></table>{!portal.transactions.length && <EmptyState title="Nothing here yet" copy="Your approved rewards and withdrawal records will appear here." />}</div><div className="section-block"><SectionHeading title="Task submissions" /><div className="submission-history">{portal.submissions.map((item) => <div key={item.id} className="submission-row"><span><b>{item.tasks?.name ?? 'App testing task'}</b><small>{new Date(item.created_at).toLocaleDateString()}</small></span><Status value={item.status} /><span className="amount">{points(item.reward_amount)}</span>{item.decision_reason && <small className="reason">{item.decision_reason}</small>}</div>)}</div></div></>}
        {!isAdmin && tab === 'chat' && <><div className="page-intro"><span className="eyebrow">PRIVATE SUPPORT</span><h2>Admin chat</h2><p>Messages are visible to you and authorized administrators.</p></div><div className="chat-window"><div className="chat-header"><span className="avatar admin-avatar">AS</span><span><b>APP SURVEY Admin</b><small>Private support</small></span><span className="status-chip"><i /> Available</span></div><div className="messages">{portal.messages.map((message) => <div key={message.id} className={`message ${message.sender_id === portal.profile.id ? 'mine' : ''}`}><p>{message.body}</p>{message.image_url && <a className="chat-image-link" href={message.image_url} target="_blank" rel="noreferrer"><img className="chat-image" src={message.image_url} alt="Image shared in chat" /></a>}</div>)}{!portal.messages.length && <EmptyState title="Start a conversation" copy="Send a message to the APP SURVEY admin team." />}</div><form className="chat-compose" onSubmit={(event) => submitForm(event, '/api/portal', 'Message sent.')}><input type="hidden" name="action" value="send-message" /><div className="chat-compose-row"><input name="body" maxLength={2000} placeholder="Write a message…" /><input type="file" name="image" accept="image/png,image/jpeg,image/webp" aria-label="Attach image" /></div><small>PNG, JPG or WebP · up to 8 MB</small><button className="button dark" disabled={busy}>Send ↗</button></form></div></>}

        {!isAdmin && tab === 'profile' && <div className="section-block profile-details"><span className="eyebrow">ACCOUNT DETAILS</span><h2>Your profile</h2><div className="profile-line"><span>Full name</span><b>{portal.profile.full_name}</b></div><div className="profile-line"><span>Email address</span><b>{portal.profile.email}</b></div><div className="profile-line"><span>Mobile number</span><b>{portal.profile.phone}</b></div><div className="profile-line"><span>Account status</span><Status value={portal.profile.status} /></div><div className="profile-line"><span>Chat access</span><Status value={portal.chat} /></div></div>}
        {isAdmin && tab === 'overview' && <><div className="welcome-row"><div><span className="eyebrow">OPERATIONS / TODAY</span><h2>Good morning, {portal.profile.full_name.split(' ')[0]}.</h2><p>Here is what needs your attention.</p></div><span className="admin-badge">ADMINISTRATOR</span></div><section className="metrics"><Metric label="Registered users" value={String(adminData?.users.length ?? 0).padStart(2, '0')} detail="All member accounts" accent /><Metric label="Active tasks" value={String(adminData?.tasks.filter((task) => task.is_active).length ?? 0).padStart(2, '0')} detail="Published for testing" /><Metric label="Pending reviews" value={String(adminData?.submissions.length ?? 0).padStart(2, '0')} detail="Awaiting a decision" /><Metric label="Withdrawals" value={String(adminData?.withdrawals.length ?? 0).padStart(2, '0')} detail="Awaiting approval" /></section><section className="overview-grid"><div className="section-block"><SectionHeading title="Review queue" action="View submissions" onAction={() => setTab('reviews')} />{adminData?.submissions.slice(0, 4).map((item) => <div className="admin-queue-row" key={item.id}><span className="avatar">{item.profiles?.full_name?.slice(0, 1) ?? 'U'}</span><span><b>{item.profiles?.full_name}</b><small>{item.tasks?.name} · {new Date(item.created_at).toLocaleDateString()}</small></span><Status value="pending" /></div>)}{!adminData?.submissions.length && <EmptyState title="Queue is clear" copy="New task submissions will show here." />}</div><div className="section-block"><SectionHeading title="Withdrawal requests" action="View all" onAction={() => setTab('wallet')} />{adminData?.withdrawals.slice(0, 4).map((item) => <div className="admin-queue-row" key={item.id}><span className="avatar">₮</span><span><b>{item.profiles?.full_name}</b><small>{item.payout_details}</small></span><b className="amount">{usdt(item.amount)}</b></div>)}{!adminData?.withdrawals.length && <EmptyState title="No requests to review" copy="Withdrawal requests will show here." />}</div></section></>}
        {isAdmin && tab === 'users' && <><div className="page-intro"><span className="eyebrow">LEVEL DIRECTORY</span><h2>People</h2><p>Users start at Level 1. Upgrade members only by moving them to a higher level.</p></div>{[1,2,3,4,5].map((level) => <div className="section-block" key={level}><SectionHeading title={`Level ${level} users`} />{adminData?.users.filter((user) => (user.level ?? 1) === level).map((user) => <div className="submission-row" key={user.id}><span><b>{user.full_name}</b><small>{user.referral_code || 'Referral pending'} · {user.phone}</small></span><Status value={user.status} /><select aria-label={`Upgrade ${user.full_name}`} value={level} onChange={(event) => { const nextLevel = Number(event.target.value); if (nextLevel > level) void adminAction({ action: 'upgrade-user-level', userId: user.id, level: nextLevel }); }}><option value={level}>Level {level}</option>{[2,3,4,5].filter((next) => next > level).map((next) => <option key={next} value={next}>Upgrade to Level {next}</option>)}</select></div>)}</div>)}</>}

        {isAdmin && tab === 'daily-points' && <><div className="page-intro"><span className="eyebrow">DAILY PAYOUT TRACKING · UTC</span><h2>Account points ledger</h2><p>Current spendable point balances and points earned today, across all member accounts.</p></div><section className="metrics"><Metric label="Points earned today" value={`${pointsEarnedToday.toLocaleString('en-US', { maximumFractionDigits: 2 })} pts`} detail={new Date().toISOString().slice(0, 10)} accent /><Metric label="Current points outstanding" value={`${totalPoints.toLocaleString('en-US', { maximumFractionDigits: 2 })} pts`} detail="Net of holds and refunds" /><Metric label="Estimated payout total" value={pointsPerUsdt > 0 ? usdt(totalPoints / pointsPerUsdt) : 'Rate not set'} detail="At configured points-to-USDT rate" /><Metric label="Accounts tracked" value={String(adminData?.users.length ?? 0)} detail="All member accounts" /></section><div className="table-wrap"><table><thead><tr><th>ACCOUNT</th><th>PHONE</th><th className="right">EARNED TODAY</th><th className="right">CURRENT POINTS</th><th className="right">EST. PAYOUT</th></tr></thead><tbody>{adminData?.users.map((user) => { const balance = Number(user.total_points ?? 0); return <tr key={user.id}><td><b>{user.full_name}</b><small>{user.email}</small></td><td>{user.phone}</td><td className="right amount">{Number(user.points_today ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} pts</td><td className="right amount">{balance.toLocaleString('en-US', { maximumFractionDigits: 2 })} pts</td><td className="right">{pointsPerUsdt > 0 ? usdt(balance / pointsPerUsdt) : 'Rate not set'}</td></tr>; })}</tbody></table>{!adminData?.users.length && <EmptyState title="No member accounts" copy="Member point balances will appear here." />}</div></>}

        {isAdmin && tab === 'admin-tasks' && <><div className="page-intro"><span className="eyebrow">TASK MANAGEMENT</span><h2>Testing tasks</h2><p>Set a level and optional closing date, or close/hide a survey immediately.</p></div><div className="section-block admin-form-block"><SectionHeading title="Create a task" /><form className="admin-task-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); void adminAction({ action: 'create-task', name: values.get('name'), description: values.get('description'), instructions: values.get('instructions'), downloadUrl: values.get('downloadUrl'), level: values.get('level'), closesAt: values.get('closesAt'), reward: values.get('reward'), duration: values.get('duration'), surveyQuestions: String(values.get('surveyQuestions') ?? '').split('\n').map((question) => question.trim()).filter(Boolean) }); form.reset(); }}><label>App or task name<input name="name" required /></label><label>Task level<select name="level" defaultValue="1"><option value="1">Level 1 — all users</option><option value="2">Level 2</option><option value="3">Level 3</option><option value="4">Level 4</option><option value="5">Level 5</option></select></label><label>Close date and time (optional)<input name="closesAt" type="datetime-local" /></label><label>Download link<input name="downloadUrl" type="url" placeholder="https://…" /></label><label>Description<textarea name="description" required /></label><label>Testing instructions<textarea name="instructions" required /></label><label>App survey questions, one per line<textarea name="surveyQuestions" minLength={5} required placeholder={'How easy was the app to use?\nWhat feature did you find most useful?'} /></label><div className="form-inline"><label>Starting reward (USDT)<input name="reward" type="number" min="1" defaultValue={settings.reward_per_task ?? 50} required /></label><label>Minimum test time<input name="duration" type="number" min="10" defaultValue="10" required /></label><button className="button dark" disabled={busy}>Publish task <span>↗</span></button></div></form></div><div className="task-list">{adminData?.tasks.map((task) => <article className="task-card" key={task.id}><div className="task-number">↗</div><div className="task-main"><div className="task-meta"><span>{task.is_active ? 'PUBLISHED' : 'CLOSED / HIDDEN'}</span><span>LEVEL {task.level ?? 1}</span>{task.closes_at && <span>CLOSES {new Date(task.closes_at).toLocaleString()}</span>}</div><h3>{task.name}</h3><p>{task.description}</p></div><div className="row-actions"><button className={task.is_active ? 'danger-action' : 'approve-action'} disabled={busy} onClick={() => void adminAction({ action: 'toggle-task', id: task.id, isActive: !task.is_active })}>{task.is_active ? 'Close / hide' : 'Reopen'}</button></div></article>)}</div></>}
        {isAdmin && tab === 'reviews' && <>
          <div className="page-intro">
            <span className="eyebrow">SUBMISSION VERIFICATION</span>
            <h2>Review queue <span className="count-pill">{adminData?.submissions.length ?? 0}</span></h2>
            <p>Review the app survey and screenshot. Choose the USDT amount to credit on approval.</p>
          </div>
          <div className="review-list">
            {adminData?.submissions.map((item) => <article className="review-card" key={item.id}>
              <div className="review-image">{item.screenshot_url ? <a href={item.screenshot_url} target="_blank" rel="noreferrer"><img src={item.screenshot_url} alt="Submitted task proof" /></a> : <span>Proof unavailable</span>}</div>
              <div className="review-content">
                <div className="task-meta"><span>{item.tasks?.name}</span><Status value="pending" /></div>
                <h3>{item.profiles?.full_name}</h3>
                <p>{item.profiles?.phone} · {item.duration_minutes} min tested</p>
                <div className="survey-answers">{(item.survey_answers ?? []).map((answer: { question: string; answer: string }, answerIndex: number) => <div key={`${item.id}-${answerIndex}`}><b>{answer.question}</b><p>{answer.answer}</p></div>)}</div>
                <blockquote>{item.details}</blockquote>
                <div className="review-footer">
                  <label className="review-credit"><span>USDT to award</span><input type="number" min="1" step="1" value={reviewRewards[item.id] ?? String(item.reward_amount)} onChange={(event) => setReviewRewards((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
                  <div className="row-actions">
                    <button className="approve-action" disabled={busy} onClick={() => {
                      const reward = Number(reviewRewards[item.id] ?? item.reward_amount);
                      if (Number.isSafeInteger(reward) && reward > 0) void adminAction({ action: 'review-submission', id: item.id, approve: true, reward });
                    }}>Approve & credit</button>
                    <button className="danger-action" disabled={busy} onClick={() => { const reason = window.prompt('Reason for rejection (shown to user):'); if (reason?.trim()) void adminAction({ action: 'review-submission', id: item.id, approve: false, reason }); }}>Reject</button>
                  </div>
                </div>
              </div>
            </article>)}
            {!adminData?.submissions.length && <EmptyState title="All caught up" copy="Pending screenshot submissions will appear here." />}
          </div>
        </>}
        {isAdmin && tab === 'wallet' && <><div className="page-intro"><span className="eyebrow">MANUAL PAYOUT REVIEW</span><h2>Withdrawal requests</h2><p>Confirm the payout details outside the platform before approving a request.</p></div><div className="withdrawal-list">{adminData?.withdrawals.map((item) => <article className="withdrawal-row" key={item.id}><div><span className="eyebrow">{item.profiles?.phone}</span><h3>{item.profiles?.full_name}</h3><p>{item.payout_details}</p></div><b className="amount">{usdt(item.amount)}</b><div className="row-actions"><button className="approve-action" disabled={busy} onClick={() => void adminAction({ action: 'review-withdrawal', id: item.id, approve: true })}>Mark paid</button><button className="danger-action" disabled={busy} onClick={() => { const reason = window.prompt('Reason for rejecting this withdrawal:'); if (reason?.trim()) void adminAction({ action: 'review-withdrawal', id: item.id, approve: false, reason }); }}>Reject</button></div></article>)}{!adminData?.withdrawals.length && <EmptyState title="No pending withdrawals" copy="New requests will appear here for manual review." />}</div></>}

        {isAdmin && tab === 'chat' && <><div className="page-intro"><span className="eyebrow">PRIVATE SUPPORT</span><h2>Member conversations</h2><p>Only members promoted to private chat appear here.</p></div><div className="admin-chat-layout"><div className="chat-people">{adminData?.users.filter((user) => user.chat_permissions?.status === 'unlocked').map((user) => <button key={user.id} className={selectedChatUser?.id === user.id ? 'selected' : ''} onClick={() => void loadAdminChat(user)}><span className="avatar">{user.full_name?.slice(0, 1)}</span><span><b>{user.full_name}</b><small>{user.phone}</small></span><span>↗</span></button>)}{!adminData?.users.some((user) => user.chat_permissions?.status === 'unlocked') && <EmptyState title="No promoted members" copy="Promote a member from People to enable private chat." />}</div><div className="chat-window admin-chat-window">{selectedChatUser ? <><div className="chat-header"><span className="avatar">{selectedChatUser.full_name?.slice(0, 1)}</span><span><b>{selectedChatUser.full_name}</b><small>{selectedChatUser.phone}</small></span><Status value="unlocked" /></div><div className="messages">{adminMessages.map((message) => <div key={message.id} className={`message ${message.sender_id === portal.profile.id ? 'mine' : ''}`}><p>{message.body}</p>{message.image_url && <a className="chat-image-link" href={message.image_url} target="_blank" rel="noreferrer"><img className="chat-image" src={message.image_url} alt="Image shared in chat" /></a>}</div>)}{!adminMessages.length && <EmptyState title="No messages yet" copy="Start the conversation with this member." />}</div><form className="chat-compose" onSubmit={sendAdminMessage}><div className="chat-compose-row"><input name="body" maxLength={2000} placeholder="Write a message…" /><input type="file" name="image" accept="image/png,image/jpeg,image/webp" aria-label="Attach image" /></div><small>PNG, JPG or WebP · up to 8 MB</small><button className="button dark">Send ↗</button></form></> : <EmptyState title="Choose a conversation" copy="Select a promoted member to open private chat." />}</div></div></>}
        {isAdmin && tab === 'settings' && <><div className="page-intro"><span className="eyebrow">REWARD POLICY</span><h2>Reward settings</h2><p>Set referral rewards, level upgrade rewards, and the dashboard notice shown after login.</p></div><div className="section-block settings-block"><form onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void adminAction({ action: 'update-referral-settings', referralReward: values.get('referralReward'), level2Reward: values.get('level2Reward'), level3Reward: values.get('level3Reward'), level4Reward: values.get('level4Reward'), level5Reward: values.get('level5Reward') }); }}><label>Referral signup reward (USDT)<input name="referralReward" type="number" min="0" step="0.01" defaultValue={settings.referral_signup_reward ?? 5} required /></label><label>Level 2 upgrade reward to downliner (USDT)<input name="level2Reward" type="number" min="0" step="0.01" defaultValue={settings.level_2_upgrade_reward ?? 0} required /></label><label>Level 3 upgrade reward to downliner (USDT)<input name="level3Reward" type="number" min="0" step="0.01" defaultValue={settings.level_3_upgrade_reward ?? 0} required /></label><label>Level 4 upgrade reward to downliner (USDT)<input name="level4Reward" type="number" min="0" step="0.01" defaultValue={settings.level_4_upgrade_reward ?? 0} required /></label><label>Level 5 upgrade reward to downliner (USDT)<input name="level5Reward" type="number" min="0" step="0.01" defaultValue={settings.level_5_upgrade_reward ?? 0} required /></label><button className="button dark" disabled={busy}>Save referral settings <span>↗</span></button></form></div><div className="section-block settings-block"><SectionHeading title="Login notice banner" /><form onSubmit={publishNotice}><label>Notice message<textarea name="message" placeholder="Important update for members…" defaultValue={adminData?.notices?.[0]?.message ?? ''} /></label><label>Notice image<input name="image" type="file" accept="image/png,image/jpeg,image/webp" /><small>PNG, JPG or WebP · up to 8 MB</small></label>{adminData?.notices?.[0]?.image_url && <div className="notice-image-preview"><span>Current announcement image</span><img src={adminData.notices[0].image_url} alt="Current announcement" /></div>}<div className="row-actions"><button className="button dark" disabled={busy}>Publish announcement</button><button type="button" className="danger-action" disabled={busy} onClick={() => void adminAction({ action: 'remove-notice' })}>Remove notice</button></div></form></div></>}

      </div><footer className="workspace-footer"><span>APP SURVEY <small>· {isAdmin ? 'ADMIN' : 'MEMBER'}</small></span><span>Rewards are subject to task terms and approval.</span></footer>
    </main></div>;
  }

function Metric({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return <article className={`metric ${accent ? 'metric-accent' : ''}`}><span>{label}</span><b>{value}</b><small>{detail}</small></article>;
}
function SectionHeading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <div className="section-heading"><h3>{title}</h3>{action && <button onClick={onAction}>{action} <span>↗</span></button>}</div>;
}
function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><span>↗</span><b>{title}</b><p>{copy}</p></div>;
}
function Status({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  return <span className={`status status-${normalized}`}>{value.replaceAll('_', ' ')}</span>;
}
function ActivityList({ items }: { items: any[] }) {
  return <div className="activity-list">{items.map((item) => <div className="activity-row" key={item.id}><span className="activity-icon">{item.kind === 'task_reward' ? '✓' : '↗'}</span><span><b>{item.description || item.kind.replaceAll('_', ' ')}</b><small>{new Date(item.created_at).toLocaleDateString()}</small></span><span className="activity-amount">{points(item.amount)}</span></div>)}</div>;
}
function TaskCompact({ task, onOpen }: { task: Task; onOpen: () => void }) {
  return <button className="compact-task" onClick={onOpen}><span className="compact-icon">AS</span><span><b>{task.name}</b><small>{task.min_duration_minutes} min · app testing</small></span><strong>{points(task.reward)}</strong><span>↗</span></button>;
}
