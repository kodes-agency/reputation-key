import type { Database, Tx } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { NotificationEmailId, NotificationId } from '#/shared/domain/ids'
import { unbrand } from '#/shared/domain/ids'
import type { ReviewRatingForRouting } from '../application/ports/cross-context-lookups.port'
import type { NotificationEmail } from '../domain/notification-types'
import type { InsertNotificationInput } from '../application/use-cases/insert-notification'
import { insertNotification } from '../application/use-cases/insert-notification'
import type { NotificationEmailRepositoryPort } from '../application/ports/notification-email-repository.port'
import type { NotificationAudience } from '../application/notification-audience'
import { createNotificationRepository } from '../infrastructure/repositories/notification.repository'
import { createNotificationEmailRepository } from '../infrastructure/repositories/notification-email.repository'
import { createNotificationPreferenceRepository } from '../infrastructure/repositories/notification-preference.repository'

export type NoticeWriteSettings = Readonly<{
  db: Database
  clock: () => Date
  idGen: () => NotificationId
  emailIdGen: () => NotificationEmailId
  logger: LoggerPort
  /** Review's read, on its own connection; compared and dropped, never stored. */
  ratingForRouting: ReviewRatingForRouting
  enqueueImmediateEmail?: (data: {
    notificationEmailId: string
    organizationId: string
    propertyId?: string
  }) => Promise<void>
}>

type NoticeWriteDeps = Omit<NoticeWriteSettings, 'db' | 'enqueueImmediateEmail'>

export async function enqueueImmediateAfterCommit(
  deps: Pick<NoticeWriteSettings, 'enqueueImmediateEmail' | 'logger'>,
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
    // digest run's orphan sweep re-enqueues it, Property- and
    // Organization-scoped alike. `correlationId` is the opaque string the
    // urgent-email envelope carries, so an operator can find the stranded row;
    // no tenant/entity identifiers are logged.
    deps.logger.error(
      {
        err,
        correlationId: `notification-email:${unbrand(email.id)}`,
        cadence: 'immediate',
      },
      'Immediate notification email enqueue failed after delivery settlement',
    )
  }
}

/**
 * Writes one notice, its preferences-resolved channels and any email-queue row
 * on the given transaction, and returns the immediate email row it queued so
 * the caller can hand it to Redis after commit. Redis is deliberately outside
 * the database transaction.
 */
export async function writeNoticeInTransaction(
  deps: NoticeWriteDeps,
  tx: Tx,
  input: InsertNotificationInput,
  audience: NotificationAudience,
): Promise<NotificationEmail | null> {
  // Drizzle's transaction handle implements the same query surface the
  // adapters need; keep the cast at this infrastructure boundary.
  const transactionDb = tx as unknown as Database
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
    ratingForRouting: deps.ratingForRouting,
  })(input, audience)
  return insertedEmail
}
