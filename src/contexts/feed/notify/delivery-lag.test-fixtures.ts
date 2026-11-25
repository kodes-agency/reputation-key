// Shared by the delivery lag suites that commit rows and clear them again.

import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  notificationEmailQueue,
  notifications,
  outboxEvents,
  properties,
} from '#/shared/db/schema'
import type { readNotificationDeliveryLag } from './delivery-lag.server'

export type LagWindow = Parameters<typeof readNotificationDeliveryLag>[2]
export type EmailAcceptance = Awaited<
  ReturnType<typeof readNotificationDeliveryLag>
>['immediateEmailAcceptance']

/** An acceptance section with every field named, defaulting to "nothing seen". */
export const acceptance = (fields: Partial<EmailAcceptance> = {}): EmailAcceptance => ({
  awaitingProviderAcceptance: 0,
  attemptedAwaitingProviderAcceptance: 0,
  oldestAwaitingSourceRecordedAt: null,
  acceptedLatencyP99Ms: null,
  acceptedSampleCount: 0,
  sourceUnlinked: 0,
  saturated: false,
  ...fields,
})

/** The queue columns of an email the provider took at `at`. */
export const acceptedAt = (at: Date) => ({
  status: 'accepted',
  attemptedAt: at,
  acceptedAt: at,
  updatedAt: at,
})

export const clearOrganization = async (db: Database, org: string) => {
  await db
    .delete(notificationEmailQueue)
    .where(eq(notificationEmailQueue.organizationId, org))
  await db.delete(notifications).where(eq(notifications.organizationId, org))
  await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, org))
  await db.delete(properties).where(eq(properties.organizationId, org))
}

/** Generous for these small reads; the timeout suite pins the cancellation. */
export const STATEMENT_TIMEOUT_MS = 10_000
