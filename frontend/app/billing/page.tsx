'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getHistory } from '@/lib/api/endpoints';
import { fmtDate } from '@/components/billing/status';
import { Receipt, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Clock } from 'lucide-react';
import Link from 'next/link';

export default function Billing() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ['hist', page],
    queryFn: () => getHistory(page),
  });

  if (isLoading) {
    return (
      <div className="card max-w-4xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-tint rounded animate-pulse" />
        <div className="h-64 bg-tint/50 rounded animate-pulse" />
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

  if (!data?.items.length) {
    return (
      <div className="card max-w-md mx-auto text-center p-8 space-y-4">
        <Receipt className="mx-auto h-12 w-12 opacity-30 text-ink" />
        <h1 className="text-xl font-bold text-ink">No Transactions Yet</h1>
        <p className="text-sm muted">
          Payments and official receipts will appear here once you complete a subscription checkout.
        </p>
        <Link href="/pricing" className="btn !w-auto inline-block">
          Explore Plans
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">Billing &amp; Invoices</h1>
          <p className="mt-1 text-sm muted">
            View your verified payment history, transaction references, and settlement details.
          </p>
        </div>
        <Link href="/dashboard" className="btn-quiet !w-auto text-sm">
          Back to Dashboard
        </Link>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Billing history transactions</caption>
            <thead>
              <tr className="bg-tint border-b border-line text-xs font-bold text-ink uppercase tracking-wider">
                <th className="p-4">Order ID</th>
                <th className="p-4">PayU Reference</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Date &amp; Time</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((t) => (
                <tr key={t.orderId} className="hover:bg-tint/40 transition-colors">
                  <td className="p-4 font-mono text-xs font-semibold text-ink">{t.orderId}</td>
                  <td className="p-4 font-mono text-xs muted">{t.txnRef ?? '—'}</td>
                  <td className="p-4 font-bold text-ink">
                    {t.currency} {t.amount}
                  </td>
                  <td className="p-4 text-xs muted">{fmtDate(t.paidAt)}</td>
                  <td className="p-4">
                    {t.status === 'SUCCESS' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2.5 py-0.5 text-xs font-bold text-ok">
                        <CheckCircle2 className="h-3 w-3" />
                        SUCCESS
                      </span>
                    ) : t.status === 'PENDING' || t.status === 'VERIFICATION_PENDING' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-signal/10 px-2.5 py-0.5 text-xs font-bold text-signal">
                        <Clock className="h-3 w-3" />
                        PENDING
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warn/10 px-2.5 py-0.5 text-xs font-bold text-warn">
                        <XCircle className="h-3 w-3" />
                        {t.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data.pageCount > 1 && (
          <div className="p-4 border-t border-line flex items-center justify-between text-sm">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="btn-quiet !w-auto text-xs py-1.5 px-3 flex items-center gap-1 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <span className="muted text-xs font-medium">
              Page {data.page} of {data.pageCount}
            </span>
            <button
              disabled={page >= data.pageCount}
              onClick={() => setPage((p) => Math.min(data.pageCount, p + 1))}
              className="btn-quiet !w-auto text-xs py-1.5 px-3 flex items-center gap-1 disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
