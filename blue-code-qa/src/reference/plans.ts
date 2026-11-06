export interface Plan {
  id: string;
  name: string;
  amount: string; // canonical decimal string, server-owned
  currency: 'INR';
  interval: 'month' | 'year';
  count: number;
}

export const PLANS: readonly Plan[] = [
  { id: 'starter_monthly', name: 'Starter Monthly', amount: '499.00', currency: 'INR', interval: 'month', count: 1 },
  { id: 'pro_monthly', name: 'Pro Monthly', amount: '1499.00', currency: 'INR', interval: 'month', count: 1 },
  { id: 'pro_yearly', name: 'Pro Yearly', amount: '14990.00', currency: 'INR', interval: 'year', count: 1 },
];

export function getPlan(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/** Calendar arithmetic in UTC with end-of-month clamping (Jan 31 + 1 month = Feb 28/29). */
export function addInterval(from: Date, interval: 'month' | 'year', count: number): Date {
  const months = interval === 'year' ? count * 12 : count;
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
