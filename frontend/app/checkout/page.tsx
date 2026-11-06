'use client';

import { useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck,
  CheckCircle2,
  Lock,
  CreditCard,
  Sparkles,
  ArrowRight,
  AlertCircle,
  Check,
} from 'lucide-react';
import { getPlans, initiatePayment, getSubscription } from '@/lib/api/endpoints';
import { checkoutSchema } from '@/lib/validation/schemas';
import { submitPayuRedirect } from '@/lib/payu';

function CheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawPlanId = searchParams.get('plan') ?? '';
  const { data: plans, isLoading: plansLoading } = useQuery({ queryKey: ['plans'], queryFn: getPlans });
  const { data: sub } = useQuery({ queryKey: ['sub'], queryFn: getSubscription });

  const selectedPlan = plans?.find((p) => p.id === rawPlanId) ?? plans?.[0];
  const planId = selectedPlan?.id ?? rawPlanId ?? 'basic-monthly';

  const [terms, setTerms] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const handleTermsChange = (checked: boolean) => setTerms(checked);

  const idempotencyKey = useRef(crypto.randomUUID());

  const displayAmount = selectedPlan?.amountLabel ?? 'INR 9.00';

  // Duplicate purchase check: if user already has an active subscription for this plan
  const isAlreadySubscribed = sub?.status === 'ACTIVE' && (
    sub?.planName === selectedPlan?.name || (sub?.planName && selectedPlan?.name && sub.planName.toLowerCase() === selectedPlan.name.toLowerCase())
  );

  async function handlePayuSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    if (isAlreadySubscribed) {
      setErr('You already have an active subscription for this plan. You can renew shortly before it ends.');
      return;
    }

    const p = checkoutSchema.safeParse({ planId, acceptTerms: terms });
    if (!p.success) {
      setErr(p.error.issues[0]?.message ?? 'Please accept the terms to proceed');
      return;
    }

    setBusy(true);
    setErr('');
    try {
      const o = await initiatePayment({ planId, idempotencyKey: idempotencyKey.current });
      submitPayuRedirect(o.redirect);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  if (plansLoading) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <div className="card h-48 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">Checkout & Payment</h1>
        <p className="mt-1 text-sm muted">
          Complete your subscription securely via our authorized PayU merchant gateway.
        </p>
      </div>

      {isAlreadySubscribed && (
        <div role="alert" className="rounded-xl border border-caution/40 bg-caution/10 p-4 text-sm text-ink flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-caution shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-caution">Subscription Already Active</p>
            <p className="mt-1 text-xs muted">
              You currently hold an active subscription to <strong>{selectedPlan?.name}</strong>.
              Duplicate purchases for the same active plan are prevented. You may renew within 7 days of expiry.
            </p>
            <button
              onClick={() => router.push('/dashboard')}
              className="btn-quiet mt-3 text-xs !py-1.5 !px-3"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      )}

      {/* Plan Summary Card */}
      <div className="rounded-xl border border-line bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-start justify-between border-b border-line pb-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-signal">Selected Plan</span>
            <h2 className="text-xl font-bold text-ink">{selectedPlan?.name ?? 'Blue Code OS Plan'}</h2>
            <p className="mt-1 text-sm muted">
              {selectedPlan?.description ?? 'Complete software tools subscription'}
            </p>
          </div>
          <div className="text-right">
            <span className="text-2xl font-black text-signal">{displayAmount}</span>
            <p className="text-xs muted">Standard price</p>
          </div>
        </div>

        {selectedPlan?.features && (
          <ul className="space-y-1.5 py-1 text-xs text-ink">
            {selectedPlan.features.slice(0, 4).map((f) => (
              <li key={f} className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-ok shrink-0" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-line pt-3 flex justify-between items-center text-sm">
          <span className="font-semibold text-ink">Total payable amount:</span>
          <span className="text-xl font-black text-ok">{displayAmount}</span>
        </div>
      </div>

      {/* PayU Official Payment Card */}
      <div className="rounded-xl border border-line bg-card p-6 shadow-sm space-y-5">
        <div className="rounded-xl bg-tint p-4 text-xs text-ink border border-line space-y-2">
          <div className="flex items-center gap-2 font-bold text-sm">
            <CreditCard className="h-4 w-4 text-signal" />
            <span>PayU Secure Payment Gateway</span>
          </div>
          <p className="muted">
            Payment transactions are processed through our authorized PayU merchant account (MID: <strong>13844503</strong>).
            You can pay using <strong>Google Pay</strong>, PhonePe, Paytm (UPI), Cards (Visa/Mastercard/RuPay), NetBanking, or Wallets.
          </p>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ok">
            <Check className="h-3.5 w-3.5" />
            <span>Server-side verified transaction &bull; Automatic instant activation</span>
          </div>
        </div>

        <form onSubmit={handlePayuSubmit} className="space-y-4">
          <label className="flex items-start gap-3 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleTermsChange(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-line text-signal focus:ring-signal"
            />
            <span className="text-sm muted">
              I agree to the subscription terms and authorize the transaction of {displayAmount}.
            </span>
          </label>

          {err && (
            <div role="alert" className="rounded-lg bg-warn/10 p-3 text-sm text-warn border border-warn/20 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || terms !== true || isAlreadySubscribed}
            className="btn py-4 text-base font-bold shadow-lg"
          >
            <Lock className="h-4 w-4 mr-2" />
            {busy ? 'Initiating Secure PayU Session…' : `Proceed to Pay ${displayAmount} with PayU`}
          </button>
        </form>

        <div className="flex items-center justify-center gap-2 text-xs muted pt-2 border-t border-line">
          <ShieldCheck className="h-4 w-4 text-ok" />
          <span>Strict server verification. Access is activated only upon confirmed PayU settlement.</span>
        </div>
      </div>
    </div>
  );
}

export default function Checkout() {
  return (
    <Suspense
      fallback={
        <div className="max-w-xl mx-auto space-y-4">
          <h1 className="text-3xl font-extrabold text-ink">Checkout</h1>
          <p className="text-sm muted">Loading plan details…</p>
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
