'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import PwaInstallButton from './PwaInstallButton';

type Profile = { id: string; full_name: string; email: string; phone: string; role: string; status: string };
type Task = { id: string; name: string; description: string; download_url: string; instructions: string; survey_questions: string[]; reward: number; min_duration_minutes: number; is_active?: boolean };
type Portal = {
  profile: Profile; tasks: Task[]; submissions: any[]; balance: number; transactions: any[];
  chat: string; messages: any[]; settings: { key: string; value: number }[];
};
type AdminData = { users: any[]; tasks: Task[]; submissions: any[]; withdrawals: any[]; settings: { key: string; value: number }[]; funding: any[] };
type Tab = 'overview' | 'tasks' | 'wallet' | 'history' | 'chat' | 'profile' | 'users' | 'reviews' | 'admin-tasks' | 'settings';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Something went wrong.');
  return result as T;
}

const points = (amount: number) => `${Number(amount || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} pts`;
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
  // Frontend-only main-page instruction editor. Text stays in this browser session.
  const [mainInstructions, setMainInstructions] = useState(
    'Complete your first app-testing task, submit your survey and screenshot proof, and wait for admin approval. After approval, private admin chat will become available. The admin will share the 5 USDT registration payment details there.'
  );

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

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!portal) return;
    const stream = new EventSource('/api/chat/events');
    stream.addEventListener('message', () => { void refresh(); if (selectedChatUser) void loadAdminChat(selectedChatUser); });
    return () => stream.close();
  }, [portal?.profile.id, selectedChatUser?.id]);

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
    try {
      await request('/api/admin/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', userId: selectedChatUser.id, body: values.get('body') }) });
      form.reset();
      await loadAdminChat(selectedChatUser);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Could not send message.'); }
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const values = new FormData(event.currentTarget);
    try {
      await request('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: authMode, email: values.get('email'), phone: values.get('phone'), password: values.get('password'), fullName: values.get('fullName') }) });
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
      ? payload.approve === true ? 'Submission approved; points credited to wallet.' : 'Submission rejected.'
      : payload.action === 'review-withdrawal'
        ? payload.approve === true ? 'USDT withdrawal approved.' : 'Withdrawal rejected; points returned.'
        : 'Changes saved.';
    try { await request('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); await refresh(); setNotice(successMessage); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Could not save changes.'); }
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
    <section className="hero" id="home"><div className="hero-copy"><span className="eyebrow">A better way to try what is next</span><h1>Test apps.<br /><em>Earn rewards.</em></h1><p>Discover new apps, share useful feedback, and earn verified rewards for completed testing tasks.</p><div className="hero-actions"><a className="button primary" href="#join">Create your account <span>↗</span></a><a className="text-link" href="#how">How it works <span>↓</span></a></div><div className="trust-note"><span className="checkmark">✓</span> No upfront payment. Complete your first task before paying the 5 USDT registration fee.</div></div><div className="hero-art" aria-label="App testing task preview"><div className="art-top"><span>YOUR NEXT TEST</span><span className="live-dot" /></div><div className="art-icon">a<span>.</span></div><p className="art-label">Task 024 / Mobile apps</p><h2>Everyday, made easier.</h2><p className="art-desc">Explore a new productivity app and share what you think.</p><div className="art-bottom"><span><b>10 min</b><small>TEST TIME</small></span><span><b>50 pts</b><small>REWARD</small></span><span className="art-arrow">↗</span></div><div className="art-stamp">VERIFIED<br />TASK</div></div></section>
    <section className="how-strip" id="how"><div><span className="step-no">01</span><b>Choose a task</b><small>Find an app worth exploring.</small></div><div><span className="step-no">02</span><b>Test & share</b><small>Follow the brief, send a screenshot.</small></div><div><span className="step-no">03</span><b>Get rewarded</b><small>Approved rewards go to your wallet.</small></div></section>
    <section className="main-instructions-panel" aria-labelledby="main-instructions-title" style={{ maxWidth: 1180, margin: '32px auto', padding: '28px', border: '1px solid #e5e7eb', borderRadius: 18, background: '#ffffff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
