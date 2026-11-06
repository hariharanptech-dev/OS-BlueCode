import type { DbClient } from '../db/client';
import type { EventProcessingStatus, PaymentEventType } from '../generated/prisma/client';
import { sanitizePayload } from '../shared/sanitize';

export interface NewPaymentEvent {
  paymentId: string; eventType: PaymentEventType; providerReference?: string | null;
  payload?: unknown; processingStatus?: EventProcessingStatus; receivedAt?: Date;
}

export function paymentEventRepository(db: DbClient) {
  return {
    /** Append-only. The payload ALWAYS passes through the allow-list sanitizer here, so no caller can bypass it. */
    record(e: NewPaymentEvent) {
      const processingStatus = e.processingStatus ?? 'RECEIVED';
      const receivedAt = e.receivedAt ?? new Date();
      return db.paymentEvent.create({
        data: {
          paymentId: e.paymentId, eventType: e.eventType, providerReference: e.providerReference ?? null,
          payload: sanitizePayload(e.payload), processingStatus, receivedAt,
          processedAt: processingStatus === 'RECEIVED' ? null : receivedAt,
        },
      });
    },
    markProcessed: (id: string, processingStatus: EventProcessingStatus, at: Date) =>
      db.paymentEvent.update({ where: { id }, data: { processingStatus, processedAt: at } }),
    listForPayment: (paymentId: string) => db.paymentEvent.findMany({ where: { paymentId }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] }),
  };
}
