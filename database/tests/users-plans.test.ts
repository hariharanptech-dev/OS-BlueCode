import { createRepositories } from '../src/repositories';
import { DuplicateEmailError } from '../src/shared/errors';
import { closePrisma, FAKE_ARGON2, getPrisma, makePlan, truncateAll } from './helpers/db';

const repos = () => createRepositories(getPrisma());
beforeEach(truncateAll);
afterAll(closePrisma);

describe('User', () => {
  test('creates a user with normalised email and stores only the hash', async () => {
    const u = await repos().users.create({ name: '  Asha  ', email: '  Asha@Example.COM ', passwordHash: FAKE_ARGON2 });
    expect(u.email).toBe('asha@example.com');
    expect(u.name).toBe('Asha');
    expect(u.accountStatus).toBe('ACTIVE');
    expect(u.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(u.passwordHash).toBe(FAKE_ARGON2);
  });
  test('rejects duplicate email (case-insensitively)', async () => {
    await repos().users.create({ name: 'A', email: 'dup@example.com', passwordHash: FAKE_ARGON2 });
    await expect(repos().users.create({ name: 'B', email: 'DUP@example.com', passwordHash: FAKE_ARGON2 })).rejects.toBeInstanceOf(DuplicateEmailError);
  });
  test('refuses a plain-text password in place of a hash', async () => {
    await expect(repos().users.create({ name: 'A', email: 'p@example.com', passwordHash: 'hunter2hunter2hunter2' })).rejects.toThrow(/argon2 or bcrypt/);
  });
  test('database itself rejects a mixed-case email (CHECK constraint)', async () => {
    await expect(getPrisma().user.create({ data: { name: 'A', email: 'Mixed@Example.com', passwordHash: FAKE_ARGON2 } })).rejects.toThrow();
  });
});

describe('Plan', () => {
  test('retrieval by id, code, and active listing', async () => {
    const a = await makePlan({ code: 'SAMPLE_A', priceMinor: 100 });
    await makePlan({ code: 'SAMPLE_B', priceMinor: 50, isActive: false });
    expect((await repos().plans.findById(a.id))?.code).toBe('SAMPLE_A');
    expect((await repos().plans.findByCode('SAMPLE_A'))?.id).toBe(a.id);
    expect((await repos().plans.listActive()).map((p) => p.code)).toEqual(['SAMPLE_A']);
    expect(await repos().plans.findByCode('NOPE')).toBeNull();
  });
  test('upsertByCode is idempotent (seed safety)', async () => {
    const input = { code: 'SAMPLE_X', name: 'SAMPLE', priceMinor: 100, currency: 'INR', billingInterval: 'MONTHLY' as const, durationDays: 30 };
    await repos().plans.upsertByCode(input);
    await repos().plans.upsertByCode({ ...input, priceMinor: 200 });
    const all = await getPrisma().plan.findMany();
    expect(all).toHaveLength(1);
    expect(all[0]!.priceMinor).toBe(200);
  });
  test('rejects non-positive price / duration at validation and DB level', async () => {
    const base = { code: 'SAMPLE_Z', name: 'S', currency: 'INR', billingInterval: 'MONTHLY' as const, durationDays: 30 };
    await expect(repos().plans.create({ ...base, priceMinor: 0 })).rejects.toThrow();
    await expect(getPrisma().plan.create({ data: { ...base, priceMinor: -5 } })).rejects.toThrow();
    await expect(getPrisma().plan.create({ data: { ...base, priceMinor: 5, durationDays: 0 } })).rejects.toThrow();
  });
});
