// What the settlement suites share: consumer deps over the transaction a suite
// holds open, and reads of the rows a settlement is meant to change.

import { vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notifications } from '#/shared/db/schema'
import { inboxItemId, type InboxItemId } from '#/shared/domain/ids'
import { SETTLED_EMAIL_REASON } from '../domain/notification-actionable'
import type { NotificationSettlementConsumerDeps } from './notification-settlement-outbox-consumers'
import {
  createFakeJobLogger,
  noGroupedReopens,
  waitingWorkState,
} from './jobs/test-fixtures'
import { readEmail, notificationIdOf, emailIdOf } from './jobs/delivery-seed'

export const settlementDeps = (
  db: Database,
  input: Readonly<{ now: Date; item?: InboxItemId | null }>,
) =>
  ({
    db,
    groupedReopens: noGroupedReopens(),
    inboxItemLookup: {
      findInboxItemByReviewId: vi.fn(async (): Promise<InboxItemId | null> =>
        input.item === undefined ? inboxItemId('settlement-item') : input.item,
      ),
    },
    workState: waitingWorkState(),
    clock: () => input.now,
    logger: createFakeJobLogger(),
    receipts: { insertReceipt: vi.fn(async () => undefined) },
  }) satisfies NotificationSettlementConsumerDeps

/** Whether the notice seeded under `name` was settled, and when. */
export const settledAt = async (db: Database, name: string): Promise<Date | null> => {
  const [row] = await db
    .select({ resolvedAt: notifications.resolvedAt })
    .from(notifications)
    .where(eq(notifications.id, notificationIdOf(name)))
  if (!row) throw new Error(`No notice ${name}`)
  return row.resolvedAt
}

/** The queued mail behind the notice seeded under `name`. */
export const queuedMail = async (db: Database, name: string) => {
  const email = await readEmail(db, emailIdOf(name))
  return {
    cancelled: email.status === 'cancelled',
    reason: email.suppressionReason,
  }
}

export const MAIL_CANCELLED = { cancelled: true, reason: SETTLED_EMAIL_REASON }
export const MAIL_QUEUED = { cancelled: false, reason: null }
