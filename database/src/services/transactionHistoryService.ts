import type { PrismaClient } from '../db/client';
import { createRepositories } from '../repositories';
import { NotFoundError, ValidationError } from '../shared/errors';
import { listPaymentsSchema, type ListPaymentsInput } from '../validation/schemas';

const encode = (d: Date, id: string) => Buffer.from(`${d.toISOString()}|${id}`).toString('base64url');
function decode(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const d = new Date(iso ?? '');
  if (!id || Number.isNaN(d.getTime())) throw new ValidationError('Invalid cursor');
  return { createdAt: d, id };
}

/** Read-only, ownership-scoped views for customer-facing history. Never returns another user's data. */
export class TransactionHistoryService {
  constructor(private readonly prisma: PrismaClient) {}

  async listPayments(input: ListPaymentsInput) {
    const q = listPaymentsSchema.parse(input);
    const rows = await createRepositories(this.prisma).payments.listByUser(q.userId, {
      limit: q.limit + 1, status: q.status, before: q.cursor ? decode(q.cursor) : undefined,
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const items = page.map((p) => ({
      id: p.id, orderId: p.orderId, status: p.status, amountMinor: p.amountMinor, currency: p.currency,
      plan: p.plan, initiatedAt: p.initiatedAt, verifiedAt: p.verifiedAt, createdAt: p.createdAt, failureReason: p.failureReason,
    }));
    return { items, nextCursor: rows.length > q.limit && last ? encode(last.createdAt, last.id) : null };
  }

  /** Payment + audit events + resulting subscription. NotFound (not Forbidden) when the payment belongs to someone else. */
  async getPaymentDetail(userId: string, paymentId: string) {
    const p = await this.prisma.payment.findFirst({
      where: { id: paymentId, userId },
      include: { plan: { select: { code: true, name: true } }, events: { orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] }, subscription: true },
    });
    if (!p) throw new NotFoundError('Payment', paymentId);
    return p;
  }

  listSubscriptions(userId: string) {
    return createRepositories(this.prisma).subscriptions.listByUser(userId);
  }
}
