// Rows for the delivery job suites, written through the schema into the
// transaction a suite holds open. Ids are derived from names so a test can
// say "the email for Riverside" and find it again.

import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  eventConsumerReceipts,
  notificationEmailQueue,
  notificationPreferences,
  notificationUserSettings,
  notifications,
} from '#/shared/db/schema'
import type { NotificationPayload } from '../domain/notification-payload'

/** A UUID that is the same for the same name, and different for any other. */
export const stableUuid = (...parts: readonly string[]): string => {
  const hex = createHash('sha256').update(parts.join('\u0000')).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

type Providers = (typeof notificationEmailQueue.$inferInsert)['providerRequest']

export type NoticeSeed = Readonly<{
  /** Names the rows; two seeds with the same name are the same ids. */
  name: string
  organizationId: string
  userId: string
  propertyId: string | null
  createdAt: Date
  type?: string
  category?: string
  priority?: string
  resourceType?: string
  resourceId?: string
  payload?: NotificationPayload
  title?: string
  resolvedAt?: Date | null
  /** The outbox event the notification was made from. */
  eventId?: string
  updatedAt?: Date
  coalescedCount?: number
  /** `false` leaves the queue row without the notification it points at. */
  withNotification?: boolean
  email?: Readonly<{
    category?: string
    cadence?: 'immediate' | 'daily'
    status?: string
    priority?: string
    retryCount?: number
    notBefore?: Date | null
    nextAttemptAt?: Date | null
    attemptedAt?: Date | null
    acceptedAt?: Date | null
    lastErrorClass?: string | null
    idempotencyKey?: string
    createdAt?: Date
    updatedAt?: Date
    providerRequest?: Providers
    recipientAudience?: unknown
  }>
}>

export type SeededNotice = Readonly<{
  notificationId: string
  emailId: string
}>

export const emailIdOf = (name: string): string => stableUuid('email', name)
export const notificationIdOf = (name: string): string => stableUuid('notification', name)

type NotificationInsert = typeof notifications.$inferInsert
type EmailQueueInsert = typeof notificationEmailQueue.$inferInsert

const noticeCategory = (seed: NoticeSeed): string =>
  seed.category ?? seed.email?.category ?? 'urgent_operational'

const notificationRow = (seed: NoticeSeed): NotificationInsert => ({
  id: notificationIdOf(seed.name),
  userId: seed.userId,
  organizationId: seed.organizationId,
  propertyId: seed.propertyId,
  type: seed.type ?? 'reply.publish_failed',
  category: noticeCategory(seed),
  priority: seed.priority ?? 'normal',
  resourceType: seed.resourceType ?? 'inbox_item',
  resourceId: seed.resourceId ?? `resource-${seed.name}`,
  eventId: seed.eventId ?? `event-${seed.name}`,
  // A raw identifier on purpose: pre-template rows look like this, and the
  // renderer must never ship it.
  title: seed.title ?? 'Inbox item 61ed98fc-1c2b-4d6e-9f00-000000000001',
  payload: seed.payload ?? {},
  resolvedAt: seed.resolvedAt ?? null,
  ...(seed.coalescedCount === undefined ? {} : { coalescedCount: seed.coalescedCount }),
  createdAt: seed.createdAt,
  updatedAt: seed.updatedAt ?? seed.createdAt,
})

const emailQueueRow = (seed: NoticeSeed): EmailQueueInsert => {
  const email = seed.email ?? {}
  const notificationId = notificationIdOf(seed.name)
  return {
    id: emailIdOf(seed.name),
    notificationId,
    userId: seed.userId,
    organizationId: seed.organizationId,
    propertyId: seed.propertyId,
    category: email.category ?? noticeCategory(seed),
    cadence: email.cadence ?? 'daily',
    status: email.status ?? 'pending',
    priority: email.priority ?? seed.priority ?? 'normal',
    idempotencyKey: email.idempotencyKey ?? `${notificationId}:email`,
    retryCount: email.retryCount ?? 0,
    notBefore: email.notBefore ?? null,
    nextAttemptAt: email.nextAttemptAt ?? null,
    attemptedAt: email.attemptedAt ?? null,
    acceptedAt: email.acceptedAt ?? null,
    lastErrorClass: email.lastErrorClass ?? null,
    providerRequest: email.providerRequest ?? null,
    recipientAudience: email.recipientAudience ?? null,
    createdAt: email.createdAt ?? seed.createdAt,
    updatedAt: email.updatedAt ?? email.createdAt ?? seed.createdAt,
  }
}

/** A notification and the queue row that mails it. */
export async function seedNotice(db: Database, seed: NoticeSeed): Promise<SeededNotice> {
  if (seed.withNotification !== false) {
    await db.insert(notifications).values(notificationRow(seed))
  }
  await db.insert(notificationEmailQueue).values(emailQueueRow(seed))
  return { notificationId: notificationIdOf(seed.name), emailId: emailIdOf(seed.name) }
}

/** An applied receipt for one consumer of an outbox event. */
export async function seedReceipts(
  db: Database,
  receipts: readonly Readonly<{ eventId: string; consumerName: string; at: Date }>[],
): Promise<void> {
  await db.insert(eventConsumerReceipts).values(
    receipts.map(({ eventId, consumerName, at }) => ({
      eventId,
      consumerName,
      status: 'applied',
      createdAt: at,
    })),
  )
}

export async function seedUserSettings(
  db: Database,
  input: Readonly<{
    userId: string
    organizationId: string
    timezone: string
    quietHoursStart?: string | null
    quietHoursEnd?: string | null
    urgentBypassEnabled?: boolean
  }>,
): Promise<void> {
  await db.insert(notificationUserSettings).values({
    userId: input.userId,
    organizationId: input.organizationId,
    timezone: input.timezone,
    quietHoursStart: input.quietHoursStart ?? null,
    quietHoursEnd: input.quietHoursEnd ?? null,
    urgentBypassEnabled: input.urgentBypassEnabled ?? false,
  })
}

export async function seedPropertyPreference(
  db: Database,
  input: Readonly<{
    userId: string
    organizationId: string
    propertyId: string
    category: string
    enabled: boolean
    cadence: 'immediate' | 'daily'
    /** Only the Low ratings category carries one. */
    maxRating?: number
  }>,
): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({ ...input, channel: 'email' })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.organizationId,
        notificationPreferences.propertyId,
        notificationPreferences.category,
        notificationPreferences.channel,
      ],
      set: {
        enabled: input.enabled,
        cadence: input.cadence,
        maxRating: input.maxRating ?? null,
      },
    })
}

/** The email preference a notice's category starts with, unless the suite set one. */
export async function seedEmailPreferenceIfAbsent(
  db: Database,
  input: Parameters<typeof seedPropertyPreference>[1],
): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({ ...input, channel: 'email' })
    .onConflictDoNothing()
}

export const readEmail = async (db: Database, emailId: string) => {
  const [row] = await db
    .select()
    .from(notificationEmailQueue)
    .where(eq(notificationEmailQueue.id, emailId))
  if (!row) throw new Error(`No queue row ${emailId}`)
  return row
}
