'use client';

import { CheckCircle2, XCircle, Ban, Clock, ArrowRight, ShieldCheck, Check } from 'lucide-react';
import Link from 'next/link';
import type { PaymentStatus } from '@/types';
import { STATUS_COPY } from './copy';

export interface StatusViewProps {
  status: PaymentStatus;
  orderId?: string;
  txnRef?: string;
  amount?: string;
  currency?: string;
  planName?: string;
}

const ICONS = {
  SUCCESS: { icon: CheckCircle2, color: 'text-ok bg-ok/10 border-ok/30' },
  FAILED: { icon: XCircle, color: 'text-warn bg-warn/10 border-warn/30' },
  CANCELLED: { icon: Ban, color: 'text-caution bg-caution/10 border-caution/30' },
  PENDING: { icon: Clock, color: 'text-signal bg-signal/10 border-signal/30' },
  EXPIRED: { icon: Clock, color: 'text-caution bg-caution/10 border-caution/30' },
  CREATED: { icon: Clock, color: 'text-signal bg-signal/10 border-signal/30' },
  VERIFICATION_PENDING: { icon: Clock, color: 'text-signal bg-signal/10 border-signal/30' },
} as const;

export function StatusView({
  status,
  orderId,
  txnRef,
  amount,
  currency = 'INR',
  planName,
}: StatusViewProps) {
  const meta = ICONS[status as keyof typeof ICONS] ?? ICONS.PENDING;
  const copy = STATUS_COPY[status as keyof typeof STATUS_COPY] ?? {
    title: 'Processing Payment',
    body: 'We are verifying your payment with the payment gateway. Please hold on.',
  };
  const Icon = meta.icon;

  if (status === 'SUCCESS') {
    return (
      <div role="status" className="mx-auto max-w-lg space-y-6">
        <div className="card text-center p-8 border-2 border-ok shadow-xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ok/10 text-ok border border-ok/20">
            <CheckCircle2 className="h-10 w-10 animate-bounce" />
          </div>

          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-3.5 py-1 text-xs font-bold text-ok border border-ok/20">
            <ShieldCheck className="h-3.5 w-3.5" />
            Verified &amp; Confirmed Transaction
          </div>

          <h1 className="mt-3 text-2xl font-extrabold text-ink md:text-3xl">Payment Successful</h1>
          <p className="mt-1 text-sm muted">
            Payment has been successfully verified. Your Blue Code OS subscription is active.
          </p>

          <div className="mt-6 rounded-xl bg-tint p-5 text-left space-y-3 text-sm border border-line">
            <div className="flex justify-between items-center border-b border-line pb-2">
              <span className="muted">Subscription Plan</span>
              <span className="font-bold text-ink">{planName ?? 'Blue Code OS Plan'}</span>
            </div>
            {amount && (
              <div className="flex justify-between items-center border-b border-line pb-2">
                <span className="muted">Amount Paid</span>
                <span className="font-extrabold text-ok text-lg">
                  {currency} {amount}
                </span>
              </div>
            )}
            {orderId && (
              <div className="flex justify-between items-center text-xs border-b border-line pb-2">
                <span className="muted">Order Reference</span>
                <span className="font-mono text-ink font-semibold">{orderId}</span>
              </div>
            )}
            {txnRef && (
              <div className="flex justify-between items-center text-xs border-b border-line pb-2">
                <span className="muted">PayU Transaction ID</span>
                <span className="font-mono font-semibold text-ink">{txnRef}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-1">
              <span className="muted">Account Status</span>
              <span className="rounded-full bg-ok/15 text-ok px-2.5 py-0.5 text-xs font-bold uppercase inline-flex items-center gap-1">
                <Check className="h-3 w-3" /> Paid &amp; Active
              </span>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <Link
              href="/dashboard"
              className="btn py-3.5 font-bold shadow-md"
            >
              <span>Go to Your Active Dashboard</span>
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
            <Link
              href="/billing"
              className="btn-quiet py-2.5 text-sm"
            >
              View Billing &amp; Transaction History
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div role="status" className="card mx-auto max-w-md text-center p-8 space-y-4">
      <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full border ${meta.color}`}>
        <Icon className={`h-8 w-8 ${status === 'PENDING' || status === 'VERIFICATION_PENDING' ? 'animate-pulse' : ''}`} />
      </div>

      <h1 className="text-2xl font-extrabold text-ink">{copy.title}</h1>
      <p className="text-sm muted">{copy.body}</p>

      {(status === 'PENDING' || status === 'VERIFICATION_PENDING') && (
        <div className="rounded-lg bg-tint p-3.5 text-xs muted border border-line">
          <p>Verifying server settlement with PayU. This status updates automatically.</p>
        </div>
      )}

      {orderId && (
        <p className="font-mono text-xs muted">Order ID: {orderId}</p>
      )}

      <div className="pt-3">
        {status === 'PENDING' || status === 'VERIFICATION_PENDING' ? (
          <div className="space-y-2.5">
            <button
              onClick={() => window.location.reload()}
              className="btn"
            >
              Check Status Again
            </button>
            <Link href="/checkout" className="btn-quiet">
              Return to Checkout
            </Link>
          </div>
        ) : (
          <Link href="/pricing" className="btn">
            Back to Plans
          </Link>
        )}
      </div>
    </div>
  );
}
