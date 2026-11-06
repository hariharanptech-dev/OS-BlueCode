'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Sparkles, ShieldCheck, CreditCard, Clock, CheckCircle2, ArrowRight } from 'lucide-react';
import { getMe, getSubscription, getHistory } from '@/lib/api/endpoints';
import { SUB_LABEL, fmtDate } from '@/components/billing/status';

export default function Dashboard() {
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const sub = useQuery({ queryKey: ['sub'], queryFn: getSubscription });
  const h = useQuery({ queryKey: ['hist', 1], queryFn: () => getHistory(1) });

  if (me.error) {
    return (
      <div className="card max-w-md mx-auto text-center border-warn/30 bg-warn/10 p-8 space-y-4">
        <p role="alert" className="text-warn font-medium">
          {(me.error as Error).message}
        </p>
        <Link href="/login" className="btn !w-auto inline-block">
          Log in
        </Link>
      </div>
    );
  }

  const isActive = sub.data?.status === 'ACTIVE';

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
          {me.data ? `Welcome, ${me.data.name}` : 'Welcome to Blue Code OS'}
        </h1>
        <p className="mt-2 text-sm muted">
          Manage your operating environment, subscription plans, and verified payments.
        </p>
      </div>

      {/* Subscription Card */}
      <section aria-label="Subscription" className="card space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider muted">
                Subscription Plan
              </span>
              {isActive && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-2.5 py-0.5 text-xs font-bold text-ok">
                  <span className="h-2 w-2 rounded-full bg-ok animate-pulse" />
                  Active
                </span>
              )}
            </div>
            <h2 className="mt-1 text-2xl font-black text-ink">
              {sub.isLoading ? 'Checking subscription…' : sub.data?.planName ?? 'None'}
            </h2>
          </div>

          <Link
            href="/pricing"
            className="btn !w-auto !py-2.5 !px-5 text-sm gap-2"
          >
            <Sparkles className="h-4 w-4" />
            <span>{isActive ? 'Upgrade Plan' : 'Select a Plan'}</span>
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <div className="rounded-xl bg-tint p-4 border border-line">
            <span className="text-xs font-medium muted uppercase tracking-wider">Status</span>
            <p className="mt-1 font-bold text-ink text-base">
              {sub.data ? SUB_LABEL[sub.data.status] : 'No active subscription'}
            </p>
          </div>
          <div className="rounded-xl bg-tint p-4 border border-line">
            <span className="text-xs font-medium muted uppercase tracking-wider">Valid Until</span>
            <p className="mt-1 font-bold text-ink text-base">
              {sub.data?.expiresAt ? fmtDate(sub.data.expiresAt) : 'N/A'}
            </p>
          </div>
        </div>
      </section>

      {/* Recent Payments Section */}
      <section aria-label="Recent payments" className="card space-y-4">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <h2 className="text-lg font-bold text-ink">Recent Transactions</h2>
          <Link href="/billing" className="text-xs font-semibold text-signal hover:underline">
            View full history &rarr;
          </Link>
        </div>

        {h.isLoading ? (
          <p role="status" className="py-4 text-sm muted">Loading transactions…</p>
        ) : h.data?.items.length ? (
          <div className="divide-y divide-line text-sm">
            {h.data.items.slice(0, 5).map((t) => (
              <div key={t.orderId} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-ink">{t.orderId}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[11px] font-bold text-ok">
                      <CheckCircle2 className="h-3 w-3" />
                      {t.status}
                    </span>
                  </div>
                  {t.txnRef && (
                    <p className="mt-0.5 font-mono text-xs muted">Ref: {t.txnRef}</p>
                  )}
                </div>
                <div className="sm:text-right">
                  <span className="font-extrabold text-ink text-base">
                    {t.currency} {t.amount}
                  </span>
                  <p className="text-xs muted">{fmtDate(t.paidAt)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 muted text-sm space-y-3">
            <Clock className="mx-auto h-8 w-8 opacity-40" />
            <p>No payments recorded yet.</p>
            <Link href="/pricing" className="inline-block text-xs font-semibold text-signal hover:underline">
              Choose a subscription to get started
            </Link>
          </div>
        )}
      </section>

      {/* Quick Navigation Footer */}
      <nav aria-label="Quick actions" className="flex flex-wrap gap-3 text-sm">
        <Link href="/pricing" className="btn-quiet !w-auto">
          Compare Plans
        </Link>
        <Link href="/billing" className="btn-quiet !w-auto">
          Billing & Invoices
        </Link>
        <Link href="/settings" className="btn-quiet !w-auto">
          Account Settings
        </Link>
      </nav>
    </div>
  );
}
