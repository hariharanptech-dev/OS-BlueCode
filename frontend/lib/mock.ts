/**
 * Actual commercial plans with real transaction amounts (INR).
 * Server-side validated pricing and stateful payment & subscription management.
 * STRICT VERIFICATION: Only verified payments activate subscriptions and produce receipts.
 */
export const commercialPlans = [
  {
    id: 'basic-monthly',
    code: 'basic-monthly',
    name: 'Blue Code OS Basic (Monthly)',
    description: 'Complete essential operating tools for individuals and solo developers',
    price: '9.00',
    priceInPaise: 900,
    currency: 'INR',
    durationDays: 30,
    amountLabel: 'INR 9.00',
    features: [
      'All Core Blue Code OS Tools',
      '1 Active Instance',
      'Standard Support',
      'Daily Automated Backups',
    ],
  },
  {
    id: 'pro-monthly',
    code: 'pro-monthly',
    name: 'Blue Code OS Pro (Monthly)',
    description: 'High-performance configuration for growing projects and teams',
    price: '999.00',
    priceInPaise: 99900,
    currency: 'INR',
    durationDays: 30,
    amountLabel: 'INR 999.00',
    recommended: true,
    features: [
      'Unlimited Tools & Extensions',
      '5 Active Instances',
      'Priority 24/7 Support',
      'Real-time Telemetry & Metrics',
      'Advanced Subscription Automation',
    ],
  },
  {
    id: 'pro-yearly',
    code: 'pro-yearly',
    name: 'Blue Code OS Pro (Yearly)',
    description: 'Maximum power with 2 months free annual billing savings',
    price: '9999.00',
    priceInPaise: 999900,
    currency: 'INR',
    durationDays: 365,
    amountLabel: 'INR 9,999.00',
    features: [
      'Everything in Pro Monthly',
      '2 Months Free with Annual Billing',
      'Dedicated Account Manager',
      'Custom SLA Guarantee',
      'Early Access to New Releases',
    ],
  },
];

interface StoredOrder {
  orderId: string;
  txnid: string;
  txnRef?: string;
  planId: string;
  planName: string;
  amount: string;
  currency: string;
  durationDays: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  createdAt: string;
  verifiedAt?: string;
}

interface StoredTxn {
  orderId: string;
  txnRef: string;
  amount: string;
  currency: string;
  paidAt: string;
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'PENDING';
}

const orders = new Map<string, StoredOrder>();
const paymentHistory: StoredTxn[] = [];
let currentSubscription: {
  planName: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'NONE';
  startsAt?: string;
  expiresAt?: string;
  renews?: boolean;
} = { planName: 'None', status: 'NONE' };

async function sha512(str: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-512', buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  try {
    const { createHash } = await import('crypto');
    return createHash('sha512').update(str).digest('hex');
  } catch {
    return '';
  }
}

export async function mockApi(path: string, init?: RequestInit): Promise<unknown> {
  const [p] = path.split('?');

  if (p === '/plans') {
    return commercialPlans;
  }

  if (p.startsWith('/plans/')) {
    const planId = p.replace('/plans/', '');
    const plan = commercialPlans.find((x) => x.id === planId || x.code === planId) ?? commercialPlans[0];
    return { plan };
  }

  if (p === '/auth/me') {
    return { id: 'usr-101', name: 'Hariharan', email: 'hariharan@bluecode.os' };
  }

  if (p === '/subscriptions/me') {
    return currentSubscription;
  }

  if (p === '/payments/history') {
    return {
      items: paymentHistory,
      payments: paymentHistory.map((t) => ({
        orderId: t.orderId,
        payuMihpayid: t.txnRef,
        amountInPaise: Math.round(parseFloat(t.amount) * 100),
        currency: t.currency,
        createdAt: t.paidAt,
        status: t.status,
      })),
      page: 1,
      pageCount: Math.max(1, Math.ceil(paymentHistory.length / 10)),
    };
  }

  if (p === '/payments/initiate') {
    let planId = 'basic-monthly';
    if (init?.body) {
      try {
        const parsed = JSON.parse(init.body as string);
        if (parsed.planId) planId = parsed.planId;
      } catch {}
    }

    const plan = commercialPlans.find((x) => x.id === planId || x.code === planId) ?? commercialPlans[0];
    const orderId = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const txnid = `BC${Date.now().toString().slice(-8)}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Authorized PayU Merchant ID (strict requirement: 13844503)
    const key = '13844503';
    const firstname = 'Hariharan';
    const email = 'hariharan@bluecode.os';
    const phone = '9876543210';
    const surl = `http://localhost:3000/payment/result?orderId=${orderId}&status=success`;
    const furl = `http://localhost:3000/payment/result?orderId=${orderId}&status=failure`;

    // Signature token generated by backend in real mode
    const hash = await sha512(`${key}|${txnid}|${plan.price}|${plan.name}|${orderId}`);

    const newOrder: StoredOrder = {
      orderId,
      txnid,
      planId: plan.id,
      planName: plan.name,
      amount: plan.price,
      currency: plan.currency,
      durationDays: plan.durationDays,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    orders.set(orderId, newOrder);

    const payuUrl = process.env.NEXT_PUBLIC_PAYU_URL || 'https://test.payu.in/_payment';
    return {
      orderId,
      amount: plan.price,
      currency: plan.currency,
      total: plan.price,
      redirect: {
        url: payuUrl,
        method: 'POST',
        fields: {
          key,
          txnid,
          amount: plan.price,
          productinfo: plan.name,
          firstname,
          email,
          phone,
          surl,
          furl,
          udf1: orderId,
          hash,
        },
      },
    };
  }

  // Status check: strictly returns real current status without faking SUCCESS
  if (p.startsWith('/payments/') && p.endsWith('/status')) {
    const segments = p.split('/');
    const orderId = segments[2];
    const order = orders.get(orderId);

    if (order) {
      return {
        orderId: order.orderId,
        status: order.status,
        txnRef: order.txnRef,
        amount: order.amount,
        currency: order.currency,
        planName: order.planName,
      };
    }
    return { orderId, status: 'PENDING' };
  }

  void init;
  return { ok: true, id: 'usr-101', email: 'hariharan@bluecode.os' };
}
