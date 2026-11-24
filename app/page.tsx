
'use client';

import { useState } from 'react';
import PwaInstallButton from './PwaInstallButton';

export default function Home() {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    const values = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: authMode,
          email: values.get('email'),
          phone: values.get('phone'),
          password: values.get('password'),
          fullName: values.get('fullName'),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Something went wrong.');
      }

      setNotice('Account request completed successfully. Please continue.');
      window.location.reload();
    } catch (issue) {
      setError(
        issue instanceof Error ? issue.message : 'Authentication failed.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="public-shell">

      <header className="public-nav">
        <a className="brand" href="#home">
          <span className="brand-mark">AS</span>
          <span>
            APP SURVEY
            <small>INDEPENDENT APP TESTING</small>
          </span>
        </a>

        <div className="public-nav-actions">
          <PwaInstallButton />
          <span className="online">
            <i /> ONLINE
          </span>
        </div>
      </header>

      {/* HERO SECTION */}

      <section className="hero" id="home">
        <div className="hero-copy">
          <span className="eyebrow">
            A better way to try what is next
          </span>

          <h1>
            Test apps.
            <br />
            <em>Earn rewards.</em>
          </h1>

          <p>
            Discover new apps, share useful feedback, and earn
            verified rewards for completed testing tasks.
          </p>

          <div className="hero-actions">
            <a className="button primary" href="#join">
              Create your account <span>↗</span>
            </a>

            <a className="text-link" href="#how">
              How it works <span>↓</span>
            </a>
          </div>

          <div className="trust-note">
            <span className="checkmark">✓</span>
            5 USDT registration fee. Payment requested after
            your first approved task.
          </div>
        </div>

        <div className="hero-art">
          <div className="art-top">
            <span>YOUR NEXT TEST</span>
            <span className="live-dot" />
          </div>

          <div className="art-icon">a<span>.</span></div>

          <p className="art-label">Task 024 / Mobile apps</p>

          <h2>Everyday, made easier.</h2>

          <p className="art-desc">
            Explore a new productivity app and share what you think.
          </p>

          <div className="art-bottom">
            <span>
              <b>10 min</b>
              <small>TEST TIME</small>
            </span>

            <span>
              <b>50 pts</b>
              <small>REWARD</small>
            </span>

            <span className="art-arrow">↗</span>
          </div>

          <div className="art-stamp">
            VERIFIED
            <br />
            TASK
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}

      <section className="how-strip" id="how">
        <div>
          <span className="step-no">01</span>
          <b>Choose a task</b>
          <small>Find an app worth exploring.</small>
        </div>

        <div>
          <span className="step-no">02</span>
          <b>Test & share</b>
          <small>Follow the brief and upload proof.</small>
        </div>

        <div>
          <span className="step-no">03</span>
          <b>Get rewarded</b>
          <small>Approved rewards go to your wallet.</small>
        </div>
      </section>

      {/* REGISTRATION AND PAYMENT INFORMATION */}

      <section className="payment-info-section">
        <div className="payment-info-card">

          <span className="eyebrow">
            HOW MEMBERSHIP WORKS
          </span>

          <h2>
            Start testing before payment.
          </h2>

          <p>
            Create your account and complete your first app-testing
            task. Once your submission is approved, private admin
            chat becomes available.
          </p>

          <div className="payment-steps">

            <div>
              <span>01</span>
              <b>Create an account</b>
              <small>
                Registration is open. No upfront payment required.
              </small>
            </div>

            <div>
              <span>02</span>
              <b>Complete your first task</b>
              <small>
                Test an app, answer the survey and upload
                screenshot proof.
              </small>
            </div>

            <div>
              <span>03</span>
              <b>Unlock admin chat</b>
              <small>
                After your first task is approved, private
                administrator chat becomes available.
              </small>
            </div>

            <div>
              <span>04</span>
              <b>Submit payment proof</b>
              <small>
                The administrator provides the 5 USDT payment
                details privately. Attach your payment receipt
                in chat for verification.
              </small>
            </div>

          </div>

          <div className="payment-fee">
            <span>REGISTRATION FEE</span>
            <strong>5 USDT</strong>
            <small>
              Payment requested after first task approval.
              No payment required to create an account.
            </small>
          </div>

        </div>
      </section>

      {/* REGISTRATION FORM */}

      <section className="join-section" id="join">

        <div className="join-copy">
          <span className="eyebrow">
            Your next useful discovery
          </span>

          <h2>
            Make your curiosity
            <br />
            count.
          </h2>

          <p>
            Join a community helping app makers build better
            products. Complete your first testing task and
            unlock private administrator support.
          </p>

          <div className="join-foot">
            <span>01 / 03</span>
            <span>5 USDT REGISTRATION FEE · PAYMENT AFTER FIRST TASK APPROVAL</span>
          </div>
        </div>

        <form className="auth-panel" onSubmit={handleAuth}>

          <div className="auth-heading">
            <span className="eyebrow">Get started</span>

            <h3>
              {authMode === 'register'
                ? 'Create your account'
                : 'Welcome back'}
            </h3>

            <p>
              {authMode === 'register'
                ? 'Sign up with email and password. Your mobile number stays on your profile.'
                : 'Sign in with your email and password.'}
            </p>
          </div>

          <div className="registration-notice">
            <span>REGISTRATION FEE</span>
            <b>5 USDT</b>
            <small>
              Payment is requested after your first approved task.
              You can register now without paying.
            </small>
          </div>

          <div className="auth-toggle">
            <button
              type="button"
              className={authMode === 'register' ? 'selected' : ''}
              onClick={() => {
                setAuthMode('register');
                setError('');
              }}
            >
              Create account
            </button>

            <button
              type="button"
              className={authMode === 'login' ? 'selected' : ''}
              onClick={() => {
                setAuthMode('login');
                setError('');
              }}
            >
              Sign in
            </button>
          </div>

          {authMode === 'register' && (
            <label>
              Full name
              <input
                name="fullName"
                autoComplete="name"
                placeholder="Your name"
                required
                minLength={2}
              />
            </label>
          )}

          <label>
            Email address
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </label>

          {authMode === 'register' && (
            <label>
              Mobile number
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="+263 771 234 567"
                required
              />
              <small>
                Use international format.
              </small>
            </label>
          )}

          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={
                authMode === 'register'
                  ? 'new-password'
                  : 'current-password'
              }
              minLength={8}
              placeholder="At least 8 characters"
              required
            />
          </label>

          {(error || notice) && (
            <p className={error ? 'form-message error' : 'form-message'}>
              {error || notice}
            </p>
          )}

          <button
            className="button primary full"
            disabled={busy}
          >
            {busy
              ? 'Please wait…'
              : authMode === 'register'
                ? 'Create account'
                : 'Sign in'}

            <span>↗</span>
          </button>

          <p className="legal-note">
            By continuing, you agree to participate honestly
            and follow each task's disclosed terms.
          </p>

        </form>
      </section>

      {/* FOOTER */}

      <footer className="public-footer">
        <span>
          APP SURVEY <small>© 2026</small>
        </span>

        <span>
          Test thoughtfully. Earn transparently.
        </span>

        <a href="#home">Back to top ↑</a>
      </footer>

      {/* COMPONENT STYLES */}

      <style jsx>{`

        .payment-info-section {
          padding: 70px 7%;
          background: #f7f8f5;
        }

        .payment-info-card {
          max-width: 1100px;
          margin: auto;
          padding: 45px;
          background: #fff;
          border: 1px solid #e7e9e4;
          border-radius: 20px;
        }

        .payment-info-card h2 {
          font-size: 34px;
          margin: 15px 0;
          color: #17251e;
        }

        .payment-info-card > p {
          max-width: 650px;
          color: #727b74;
          line-height: 1.8;
        }

        .payment-steps {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 25px;
          margin-top: 35px;
        }

        .payment-steps > div {
          padding: 22px;
          background: #f7f9f6;
          border-radius: 13px;
        }

        .payment-steps span {
          display: block;
          color: #27945c;
          font-weight: 800;
          margin-bottom: 12px;
        }

        .payment-steps b {
          display: block;
          color: #17251e;
          margin-bottom: 8px;
        }

        .payment-steps small {
          color: #778078;
          line-height: 1.6;
        }

        .payment-fee {
          margin-top: 30px;
          padding: 25px;
          background: #17251e;
          border-radius: 14px;
          color: white;
        }

        .payment-fee span,
        .payment-fee strong,
        .payment-fee small {
          display: block;
        }

        .payment-fee strong {
          font-size: 36px;
          margin: 8px 0;
        }

        .payment-fee small {
          color: #c3d0c6;
        }

        .registration-notice {
          padding: 18px;
          margin: 20px 0;
          border-radius: 12px;
          background: #f1f7f2;
          border: 1px solid #dceadd;
        }

        .registration-notice span,
        .registration-notice b,
        .registration-notice small {
          display: block;
        }

        .registration-notice span {
          color: #568267;
          font-size: 11px;
          font-weight: 700;
        }

        .registration-notice b {
          font-size: 25px;
          color: #17251e;
          margin: 5px 0;
        }

        .registration-notice small {
          color: #65736a;
          line-height: 1.6;
        }

        @media (max-width: 650px) {
          .payment-info-section {
            padding: 40px 5%;
          }

          .payment-info-card {
            padding: 25px 18px;
          }

          .payment-info-card h2 {
            font-size: 27px;
          }

          .payment-steps {
            grid-template-columns: 1fr;
          }
        }

      `}</style>

    </main>
  );
}
