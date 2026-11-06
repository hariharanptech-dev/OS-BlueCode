import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
(async () => {
  const plans = [
    { code: 'basic-monthly', name: 'Blue Code OS Basic (Monthly)', priceInPaise: 900, durationDays: 30 },
    { code: 'pro-monthly', name: 'Blue Code OS Pro (Monthly)', priceInPaise: 99900, durationDays: 30 },
    { code: 'pro-yearly', name: 'Blue Code OS Pro (Yearly)', priceInPaise: 999900, durationDays: 365 },
  ];
  for (const p of plans) await db.plan.upsert({ where: { code: p.code }, update: {}, create: p });
  console.log('seeded sample plans (placeholder prices - set your real ones)');
})().finally(() => db.$disconnect());
