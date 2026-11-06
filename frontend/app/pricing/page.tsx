'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Check, Minus, Sparkles } from 'lucide-react';
import { getPlans } from '@/lib/api/endpoints';
import { featureRows } from '@/lib/utilities/features';

export default function Pricing() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['plans'],
    queryFn: getPlans,
  });

  if (isLoading) {
    return (
      <div role="status" aria-label="Loading plans" className="grid gap-6 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card h-80 animate-pulse bg-tint/40" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="card max-w-md mx-auto text-center border-warn/30 bg-warn/10 p-6 space-y-4">
        <p className="text-warn font-medium">{(error as Error).message}</p>
        <button onClick={() => refetch()} className="btn-quiet !w-auto">
          Try again
        </button>
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div className="card max-w-md mx-auto text-center p-8 space-y-3">
        <p className="text-ink font-semibold">Plans are not available yet.</p>
        <p className="text-xs muted">Please check back shortly.</p>
      </div>
    );
  }

  return (
    <div className="space-y-12 max-w-6xl mx-auto">
      <div className="text-center max-w-2xl mx-auto space-y-2">
        <h1 className="text-3xl font-extrabold text-ink md:text-5xl tracking-tight">
          Pick the plan that fits
        </h1>
        <p className="text-base muted">
          Transparent, server-verified pricing in INR. All transactions are processed through our authorized PayU merchant account — supports Google Pay, UPI, Cards, NetBanking.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3 items-stretch">
        {data.map((p) => (
          <article
            key={p.id}
            className={`card flex flex-col justify-between relative transition-transform hover:-translate-y-1 duration-200 ${
              p.recommended ? '!border-2 !border-signal shadow-lg ring-1 ring-signal/20' : ''
            }`}
          >
            {p.recommended && (
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-signal px-3.5 py-0.5 text-xs font-bold text-white shadow-sm flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Most Popular
              </div>
            )}

            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-ink">{p.name}</h2>
                <p className="mt-1 text-xs muted min-h-[32px]">{p.description}</p>
              </div>

              <div className="pt-2 border-t border-line">
                <span className="text-3xl font-black text-ink">{p.amountLabel}</span>
                <span className="text-xs muted ml-1.5 font-medium">/ period</span>
              </div>

              <ul className="space-y-2.5 text-xs text-ink pt-2">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-6 mt-4 border-t border-line">
              <Link
                href={`/checkout?plan=${encodeURIComponent(p.id)}`}
                className={`btn ${p.recommended ? '' : 'btn-quiet'} font-bold`}
              >
                Choose {p.name}
              </Link>
            </div>
          </article>
        ))}
      </div>

      {/* Feature Comparison */}
      <div className="space-y-4 pt-6">
        <h2 className="text-2xl font-bold text-ink text-center">Compare Plan Features</h2>
        <div className="card !p-0 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Feature comparison by plan</caption>
              <thead>
                <tr className="bg-tint border-b border-line">
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-ink">Feature</th>
                  {data.map((p) => (
                    <th key={p.id} className="p-4 text-xs font-bold uppercase tracking-wider text-ink">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {featureRows(data).map((r) => (
                  <tr key={r.feature} className="hover:bg-tint/30 transition-colors">
                    <td className="p-4 font-medium text-ink">{r.feature}</td>
                    {r.has.map((h, i) => (
                      <td key={i} className="p-4">
                        {h ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-ok">
                            <Check aria-label="Included" className="h-4 w-4 text-ok" />
                            Included
                          </span>
                        ) : (
                          <Minus aria-label="Not included" className="h-4 w-4 muted opacity-40" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
