import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AppError, badRequest } from '../utils/errors';
import { logger } from '../utils/logger';

const DUMMY = bcrypt.hashSync('not-a-real-password', 12); // equalises timing for unknown emails

interface ResetEntry {
  userId: string;
  expiresAt: number;
}
const resetTokens = new Map<string, ResetEntry>();

export class AuthService {
  constructor(private db: PrismaClient) {}

  async register(i: { email: string; name: string; phone?: string; password: string }) {
    const email = i.email.toLowerCase();
    if (await this.db.user.findUnique({ where: { email } })) {
      throw new AppError('EMAIL_UNAVAILABLE');
    }
    const u = await this.db.user.create({
      data: {
        email,
        name: i.name,
        phone: i.phone,
        passwordHash: await bcrypt.hash(i.password, 12),
      },
    });
    return { id: u.id, email: u.email, name: u.name };
  }

  async login(email: string, password: string) {
    const normalised = email.toLowerCase();
    const u = await this.db.user.findUnique({ where: { email: normalised } });
    const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY);
    if (!u || !ok) throw new AppError('INVALID_CREDENTIALS');
    return { id: u.id, email: u.email, name: u.name };
  }

  async me(id: string) {
    return this.db.user.findUnique({ where: { id }, select: { id: true, email: true, name: true } });
  }

  async forgotPassword(email: string) {
    const normalised = email.toLowerCase();
    const u = await this.db.user.findUnique({ where: { email: normalised } });
    if (u) {
      const token = randomBytes(24).toString('hex');
      resetTokens.set(token, { userId: u.id, expiresAt: Date.now() + 3600_000 });
      logger.info({ email: normalised, token }, 'Password reset requested');
      return { ok: true as const, token, message: 'If an account exists for that email, a reset link is on its way.' };
    }
    return { ok: true as const, message: 'If an account exists for that email, a reset link is on its way.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const entry = resetTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      throw badRequest('Invalid or expired reset token', 'INVALID_TOKEN');
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.db.user.update({
      where: { id: entry.userId },
      data: { passwordHash },
    });
    resetTokens.delete(token);
    return { ok: true as const, message: 'Password updated successfully' };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const u = await this.db.user.findUnique({ where: { id: userId } });
    if (!u) throw new AppError('AUTH_REQUIRED');
    const ok = await bcrypt.compare(currentPassword, u.passwordHash);
    if (!ok) throw badRequest('Current password is incorrect', 'INVALID_CREDENTIALS');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.db.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    return { ok: true as const, message: 'Password updated successfully' };
  }
}
