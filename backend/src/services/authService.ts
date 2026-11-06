import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/errors';

const DUMMY = bcrypt.hashSync('not-a-real-password', 12); // equalises timing for unknown emails

export class AuthService {
  constructor(private db: PrismaClient) {}
  async register(i: { email: string; name: string; phone?: string; password: string }) {
    if (await this.db.user.findUnique({ where: { email: i.email } })) throw new AppError(409, 'EMAIL_TAKEN', 'Unable to register with these details');
    const u = await this.db.user.create({ data: { email: i.email, name: i.name, phone: i.phone, passwordHash: await bcrypt.hash(i.password, 12) } });
    return { id: u.id, email: u.email, name: u.name };
  }
  async login(email: string, password: string) {
    const u = await this.db.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY);
    if (!u || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    return { id: u.id, email: u.email, name: u.name };
  }
  async me(id: string) { return this.db.user.findUnique({ where: { id }, select: { id: true, email: true, name: true } }); }
}
