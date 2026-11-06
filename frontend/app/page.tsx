import Link from 'next/link';
import { ShieldCheck, Zap, ReceiptText, Check, Loader2, ArrowRight } from 'lucide-react';

const perks = [
  {
    i: ShieldCheck,
    t: 'Pay on PayU, not on us',
    d: 'Google Pay, PhonePe, Paytm (UPI), Cards & NetBanking details go straight to PayU. Our servers decide the price, never your browser.',
  },
  {
    i: Zap,
    t: 'Start in a minute',
    d: 'Create an account, choose a plan, and pay securely. No unnecessary forms or manual approvals.',
  },
  {
    i: ReceiptText,
    t: 'Every payment, in one place',
    d: 'See each order, its authorized reference and verified status in your real-time billing history.',
  },
];

export default function Home() {
  return (
    <div className="space-y-20">
      <section className="grid items-center gap-12 md:grid-cols-2 pt-4">
        <div className="hero-rise space-y-6">
          <h1 className="text-4xl font-extrabold leading-[1.15] tracking-tight text-ink md:text-5xl">
            Your subscription, sorted before your coffee cools.
          </h1>
          <p className="max-w-lg text-lg muted leading-relaxed">
            Blue Code OS keeps plans, payments and billing simple. Pick a plan, pay securely via our authorized PayU merchant account, and know the moment it is confirmed.
          </p>
          <div className="flex flex-wrap gap-3.5 pt-2">
            <Link href="/register" className="btn !w-auto !py-3.5 !px-6 text-base font-bold shadow-md">
              Create free account
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
            <Link href="/pricing" className="btn-quiet !w-auto !py-3.5 !px-6 text-base">
              Compare plans
            </Link>
          </div>
        </div>

        <div className="card hero-rise [animation-delay:.15s] p-7 shadow-lg space-y-5" aria-label="Example of how payment confirmation works">
          <p className="text-xs font-bold uppercase tracking-wider text-signal">How It Works</p>
          <ol className="space-y-4">
            <li className="flex items-center gap-3.5 text-sm font-medium text-ink">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ok text-white">
                <Check aria-hidden className="h-3.5 w-3.5" />
              </span>
              <span>You choose a plan and see the exact server-verified total</span>
            </li>
            <li className="flex items-center gap-3.5 text-sm font-medium text-ink">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ok text-white">
                <Check aria-hidden className="h-3.5 w-3.5" />
              </span>
              <span>You pay on PayU's 256-bit SSL secured checkout page</span>
            </li>
            <li className="flex items-center gap-3.5 text-sm font-medium text-ink">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-signal/15 text-signal">
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
              </span>
              <span>We verify with PayU server-to-server, then activate your plan</span>
            </li>
          </ol>
          <div className="rounded-xl bg-tint p-3.5 text-xs text-ink border border-line">
            We only say &ldquo;confirmed&rdquo; after PayU verifies and settles the exact amount with our backend.
          </div>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {perks.map((p) => (
          <div key={p.t} className="card p-6 space-y-3 hover:border-signal/40 transition-colors">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-tint text-signal">
              <p.i aria-hidden className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-bold text-ink">{p.t}</h2>
            <p className="text-sm muted leading-relaxed">{p.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
