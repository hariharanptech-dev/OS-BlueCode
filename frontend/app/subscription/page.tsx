'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { getSubscription } from '@/lib/api/endpoints';
import { SUB_LABEL, fmtDate } from '@/components/billing/status';
import { ShieldCheck, Calendar, RefreshCw, Sparkles, AlertCircle } from 'lucide-react';

export default function Sub() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sub'],
    queryFn: getSubscription,
  });

  if (isLoading) {
    return (
      <div className="card max-w-lg mx-auto space-y-4">
        <div className="h-8 w-40 bg-tint rounded animate-pulse" />
        <div className="h-32 bg-tint/50 rounded animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card max-w-md mx-auto text-center border-warn/30 bg-warn/10 p-6 space-y-3">
        <p role="alert" className="text-warn font-semibold">
          {(error as Error).message}
        </p>
        <button onClick={() => window.location.reload()} className="btn-quiet !w-auto">
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.status === 'NONE') {
    return (
      <div className="card max-w-md mx-auto text-center p-8 space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-tint text-signal">
          <Sparkles className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold text-ink">No Active Subscription</h1>
        <p className="text-sm muted">
          You do not have an active subscription plan right now. Choose a plan to unlock all operating tools.
        </p>
        <Link className="btn !w-auto inline-block" href="/pricing">
          Explore Plans &amp; Pricing
        </Link>
      </div>
    );
  }

  const isActive = data.status === 'ACTIVE';

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold text-ink">Subscription</h1>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase ${
            isActive ? 'bg-ok/10 text-ok border border-ok/20' : 'bg-warn/10 text-warn border border-warn/20'
          }`}
        >
          {isActive && <span className="h-2 w-2 rounded-full bg-ok animate-pulse" />}
          {SUB_LABEL[data.status]}
        </span>
      </div>

      <div className="card space-y-5">
        <div className="flex items-start justify-between border-b border-line pb-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider muted">Current Plan</span>
            <h2 className="text-2xl font-extrabold text-ink mt-0.5">{data.planName}</h2>
          </div>
          <ShieldCheck className="h-6 w-6 text-ok" />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="rounded-xl bg-tint p-3.5 border border-line">
            <span className="text-xs muted block">Activation Date</span>
            <span className="font-semibold text-ink text-sm mt-0.5 block">{fmtDate(data.startsAt)}</span>
          </div>
          <div className="rounded-xl bg-tint p-3.5 border border-line">
            <span className="text-xs muted block">Expiration Date</span>
            <span className="font-semibold text-ink text-sm mt-0.5 block">{fmtDate(data.expiresAt)}</span>
          </div>
        </div>

        <div className="rounded-xl bg-tint p-3.5 border border-line flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 muted" />
            <span className="text-ink font-medium">Automatic Renewal</span>
          </div>
          <span className="text-xs font-semibold muted">
            {data.renews ? 'Enabled' : 'Manual Renewal'}
          </span>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row gap-3">
          <Link href="/pricing" className="btn flex-1">
            Change or Renew Plan
          </Link>
          <Link href="/billing" className="btn-quiet flex-1 text-center">
            View Invoices
          </Link>
        </div>
      </div>
    </div>
  );
}
