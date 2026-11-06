/**
 * DEVELOPMENT SEED - SAMPLE DATA ONLY.
 * The plans below are placeholders so developers can exercise the payment flow. They are NOT commercial plans:
 * prices are deliberately tiny/obvious and every name/description says SAMPLE. Real plans must be created by the
 * business through an admin process, never by this script. Contains no credentials of any kind.
 * Idempotent (upsert by code). Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { createPrismaClient } from '../src/db/client';
import { createRepositories } from '../src/repositories';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed sample data in production');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const base = Number(process.env.SEED_SAMPLE_PRICE_MINOR ?? '100');
  if (!Number.isInteger(base) || base <= 0) throw new Error('SEED_SAMPLE_PRICE_MINOR must be a positive integer (minor units)');

  const prisma = createPrismaClient(url);
  try {
    const { plans } = createRepositories(prisma);
    const sample = (code: string, label: string, mult: number, interval: 'MONTHLY' | 'QUARTERLY' | 'YEARLY', days: number) => ({
      code, name: `SAMPLE - ${label} (development only)`,
      description: 'SAMPLE DATA - NOT A REAL PRODUCT. Replace with business-approved plans.',
      priceMinor: base * mult, currency: 'INR', billingInterval: interval, durationDays: days,
      features: { sample: true, note: 'placeholder - no real entitlements defined' }, isActive: true,
    });
    const seeded = [
      await plans.upsertByCode(sample('SAMPLE_PLAN_A', 'Plan A', 1, 'MONTHLY', 30)),
      await plans.upsertByCode(sample('SAMPLE_PLAN_B', 'Plan B', 2, 'QUARTERLY', 90)),
      await plans.upsertByCode(sample('SAMPLE_PLAN_C', 'Plan C', 3, 'YEARLY', 365)),
    ];
    console.log(`Seeded ${seeded.length} SAMPLE plans: ${seeded.map((p) => p.code).join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
