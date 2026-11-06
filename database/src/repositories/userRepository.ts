import type { DbClient } from '../db/client';
import { AccountStatus } from '../generated/prisma/client';
import { DuplicateEmailError, NotFoundError, uniqueViolationTarget } from '../shared/errors';
import { createUserSchema, type CreateUserInput } from '../validation/schemas';

export function userRepository(db: DbClient) {
  return {
    async create(input: CreateUserInput) {
      const data = createUserSchema.parse(input);
      try {
        return await db.user.create({ data });
      } catch (e) {
        if (uniqueViolationTarget(e)) throw new DuplicateEmailError();
        throw e;
      }
    },
    findById: (id: string) => db.user.findUnique({ where: { id } }),
    findByEmail: (email: string) => db.user.findUnique({ where: { email: email.trim().toLowerCase() } }),
    async getByIdOrThrow(id: string) {
      const u = await db.user.findUnique({ where: { id } });
      if (!u) throw new NotFoundError('User', id);
      return u;
    },
    setAccountStatus: (id: string, accountStatus: AccountStatus) => db.user.update({ where: { id }, data: { accountStatus } }),
    /** Serialises all subscription-affecting work for one user. Always acquire AFTER any payment lock. */
    async lock(id: string): Promise<void> {
      const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundError('User', id);
    },
  };
}
