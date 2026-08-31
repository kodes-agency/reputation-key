import type { Database } from '#/shared/db'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { NotificationEmailId, NotificationId } from '#/shared/domain/ids'
import { unbrand } from '#/shared/domain/ids'
import type { NotificationEmail } from '../../domain/types'
import type { InsertNotificationInput } from '../../application/use-cases/insert-notification'
import { insertNotification } from '../../application/use-cases/insert-notification'
import type { NotificationEmailRepositoryPort } from '../../application/ports/notification-email-repository.port'
import type { NotificationDeliverySettlement } from '../jobs/insert-notification.job'
import type { OutboxNotificationDelivery } from '../outbox-notification-delivery'
import { createNotificationRepository } from './notification.repository'
import { createNotificationEmailRepository } from './notification-email.repository'
import { createNotificationPreferenceRepository } from './notification-preference.repository'

type SettlementDeps = Readonly<{
  db: Database
  clock: () => Date
  idGen: () => NotificationId
  emailIdGen: () => NotificationEmailId
  logger: LoggerPort
  enqueueImmediateEmail?: (data: {
    notificationEmailId: string
    organizationId: string
    propertyId?: string
  }) => Promise<void>
}>

type TransactionOutcome =
  | Readonly<{ kind: 'duplicate' }>
  | Readonly<{ kind: 'applied'; immediateEmail: NotificationEmail | null }>

async function assertDurableSource(
  db: Database,
  organizationId: string,
  delivery: OutboxNotificationDelivery,
): Promise<void> {
  const source = await db
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.id, delivery.eventId),
        eq(outboxEvents.eventType, delivery.eventType),
        eq(outboxEvents.organizationId, organizationId),
        isNull(outboxEvents.recoveryFencedAt),
      ),
    )
    .limit(1)
  if (source.length === 0) {
    throw new Error('outbox notification durable source attribution mismatch')
  }
}

async function enqueueImmediateAfterCommit(
  deps: SettlementDeps,
  email: NotificationEmail | null,
): Promise<void> {
  if (!email || email.cadence !== 'immediate' || !deps.enqueueImmediateEmail) return
  try {
    await deps.enqueueImmediateEmail({
      notificationEmailId: unbrand(email.id),
      organizationId: unbrand(email.organizationId),
      ...(email.propertyId === null ? {} : { propertyId: unbrand(email.propertyId) }),
    })
  } catch (err) {
    // The queue row committed with the notification and remains pending. The
    // existing digest orphan sweep is the repair authority for this secondary
    // Redis edge; no tenant/entity identifiers are logged.
    deps.logger.error(
      { err, cadence: 'immediate' },
      'Immediate notification email enqueue failed after delivery settlement',
    )
  }
}

/**
 * PostgreSQL side of the Redis→notification bridge. The delivery receipt is
 * inserted first inside the same transaction as preferences, notification and
 * email-queue writes. Its primary key is the concurrency claim: one worker
 * owns the delivery; concurrent/retried workers observe `duplicate` without
 * touching the coalescing counter. Any later failure rolls the claim back with
 * every notification write.
 */
export const createNotificationDeliverySettlement = (
  deps: SettlementDeps,
): NotificationDeliverySettlement => {
  return {
    settleAuthorized: async (
      input: InsertNotificationInput,
      delivery: OutboxNotificationDelivery,
    ) => {
      const outcome = await deps.db.transaction(
        async (tx): Promise<TransactionOutcome> => {
          // Drizzle's transaction handle implements the same query surface the
          // adapters need; keep the cast at this infrastructure boundary.
          const transactionDb = tx as unknown as Database
          await assertDurableSource(transactionDb, input.organizationId, delivery)

          const claimed = await tx
            .insert(eventConsumerReceipts)
            .values({
              eventId: delivery.eventId,
              consumerName: delivery.materializedReceiptName,
              status: 'applied',
            })
            .onConflictDoNothing()
            .returning({ eventId: eventConsumerReceipts.eventId })
          if (claimed.length === 0) return { kind: 'duplicate' }

          const notificationRepo = createNotificationRepository(transactionDb)
          const baseEmailRepo = createNotificationEmailRepository(transactionDb)
          let insertedEmail: NotificationEmail | null = null
          const emailRepo: NotificationEmailRepositoryPort = {
            ...baseEmailRepo,
            insert: async (email) => {
              const inserted = await baseEmailRepo.insert(email)
              insertedEmail = inserted
              return inserted
            },
          }

          await insertNotification({
            notificationRepo,
            emailRepo,
            preferenceRepo: createNotificationPreferenceRepository(transactionDb),
            clock: deps.clock,
            idGen: deps.idGen,
            emailIdGen: deps.emailIdGen,
            logger: deps.logger,
            // Redis is deliberately outside the database transaction. The
            // captured immediate row is enqueued only after commit below.
          })(input)

          return { kind: 'applied', immediateEmail: insertedEmail }
        },
      )

      if (outcome.kind === 'duplicate') return 'duplicate'
      await enqueueImmediateAfterCommit(deps, outcome.immediateEmail)
      return 'applied'
    },

    settleObsolete: async (source, delivery) => {
      await deps.db.transaction(async (tx) => {
        const transactionDb = tx as unknown as Database
        await assertDurableSource(transactionDb, source.organizationId, delivery)
        await tx
          .insert(eventConsumerReceipts)
          .values({
            eventId: delivery.eventId,
            consumerName: delivery.materializedReceiptName,
            status: 'obsolete',
          })
          .onConflictDoNothing()
      })
    },
  }
}
