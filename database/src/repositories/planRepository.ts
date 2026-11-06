import type { DbClient } from '../db/client';
import { NotFoundError } from '../shared/errors';
import { createPlanSchema, type CreatePlanInput } from '../validation/schemas';
import type { Prisma } from '../generated/prisma/client';

export function planRepository(db: DbClient) {
  return {
    async create(input: CreatePlanInput) {
      return db.plan.create({ data: createPlanSchema.parse(input) as Prisma.PlanCreateInput });
    },
    /** Idempotent by unique `code` (used by the seed). Never touches payments already made at an older price. */
    async upsertByCode(input: CreatePlanInput) {
      const data = createPlanSchema.parse(input) as Prisma.PlanCreateInput;
      return db.plan.upsert({ where: { code: data.code }, create: data, update: data });
    },
    findById: (id: string) => db.plan.findUnique({ where: { id } }),
    findByCode: (code: string) => db.plan.findUnique({ where: { code } }),
    async getByIdOrThrow(id: string) {
      const p = await db.plan.findUnique({ where: { id } });
      if (!p) throw new NotFoundError('Plan', id);
      return p;
    },
    listActive: () => db.plan.findMany({ where: { isActive: true }, orderBy: [{ priceMinor: 'asc' }, { code: 'asc' }] }),
  };
}
