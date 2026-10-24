import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Tx } from '../database/prisma.service';

/**
 * Domain events published through the transactional outbox. Each event is written in the same
 * transaction as the state change; the OutboxDispatcher (worker) turns them into queue jobs.
 */
export type DomainEvent =
  | { type: 'user.registered'; aggregateId: string; payload: { userId: string; token: string } }
  | { type: 'user.verification_requested'; aggregateId: string; payload: { userId: string; token: string } }
  | { type: 'user.password_reset_requested'; aggregateId: string; payload: { userId: string; token: string } }
  | { type: 'booking.confirmed'; aggregateId: string; payload: { bookingId: string } }
  | { type: 'booking.cancelled'; aggregateId: string; payload: { bookingId: string; actor: string; refundMinor: number } }
  | {
      type: 'booking.rescheduled';
      aggregateId: string;
      payload: { bookingId: string; previousStartAt: string; previousEndAt: string };
    }
  | { type: 'payment.failed'; aggregateId: string; payload: { bookingId: string; paymentId: string; reason: string } }
  | { type: 'payment.conflict'; aggregateId: string; payload: { bookingId: string; paymentId: string } }
  | { type: 'refund.requested'; aggregateId: string; payload: { refundId: string } }
  | { type: 'refund.updated'; aggregateId: string; payload: { refundId: string } }
  | { type: 'teacher.approval_changed'; aggregateId: string; payload: { teacherId: string; status: string } }
  | { type: 'admin.alert'; aggregateId: string; payload: { title: string; detail: string } };

export type DomainEventType = DomainEvent['type'];

@Injectable()
export class OutboxService {
  /**
   * Timestamps come from the database clock (`now()` = start of the writing transaction), never the
   * app server's, so an event is always eligible by the time any dispatcher can see it committed.
   */
  async publish(tx: Tx, event: DomainEvent, availableAt?: Date) {
    await tx.$executeRaw`
      INSERT INTO "OutboxEvent" (id, type, "aggregateId", payload, "availableAt", "createdAt")
      VALUES (${randomUUID()}::uuid, ${event.type}, ${event.aggregateId}, ${JSON.stringify(event.payload)}::jsonb,
              COALESCE(${availableAt ?? null}::timestamptz, now()), now())`;
  }
}
