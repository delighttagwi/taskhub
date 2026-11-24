
'use client';

import React from 'react';

// USDT DISPLAY FORMATTER
export const usdt = (amount: number) =>
  `USDT ${Number(amount || 0).toFixed(2)}`;

// Reward metric
export function Metric({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <article className={`metric ${accent ? 'metric-accent' : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{detail}</small>
    </article>
  );
}

// Wallet display
export function WalletBalance({ balance }: { balance: number }) {
  return (
    <section className="wallet-hero">
      <div>
        <span className="eyebrow">YOUR WALLET BALANCE</span>
        <h2>{usdt(balance)}</h2>
        <p>Available USDT</p>
      </div>
    </section>
  );
}

// Task reward display
export function TaskReward({ reward }: { reward: number }) {
  return (
    <div className="task-reward">
      <span>REWARD</span>
      <b>{usdt(reward)}</b>
    </div>
  );
}

// Transaction display
export function TransactionAmount({
  amount,
}: {
  amount: number;
}) {
  return (
    <span className="activity-amount">
      {usdt(amount)}
    </span>
  );
}

// Admin reward input
export function RewardInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="review-credit">
      <span>USDT TO AWARD</span>
      <input
        type="number"
        min="0.01"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

// USDT withdrawal information
export function WithdrawalInfo({
  minimum,
}: {
  minimum: number;
}) {
  return (
    <div className="wallet-note">
      Minimum withdrawal: {usdt(minimum)}
    </div>
  );
}

// Example usage
export default function RewardPreview() {
  return (
    <div className="usdt-preview">
      <h2>APP SURVEY WALLET</h2>

      <div className="preview-card">
        <span>AVAILABLE BALANCE</span>
        <h1>{usdt(25)}</h1>
      </div>

      <div className="preview-card">
        <span>TASK REWARD</span>
        <h2>{usdt(0.50)}</h2>
      </div>

      <div className="preview-card">
        <span>REGISTRATION FEE</span>
        <h2>{usdt(5)}</h2>
      </div>

      <style jsx>{`
        .usdt-preview {
          display: grid;
          gap: 18px;
          padding: 24px;
          background: #f7f8f5;
          border-radius: 16px;
        }

        .preview-card {
          background: white;
          padding: 22px;
          border: 1px solid #e5e9e5;
          border-radius: 12px;
        }

        .preview-card span {
          font-size: 11px;
          font-weight: 700;
          color: #758078;
        }

        .preview-card h1,
        .preview-card h2 {
          color: #17251e;
          margin: 10px 0 0;
        }

        .preview-card h1 {
          font-size: 36px;
        }
      `}</style>
    </div>
  );
}
