// The immediate-email job against real PostgreSQL, shared by its focused test
// files. The notice, its queue row, the Property, settings, preferences and the
// refused-address list are real rows in a transaction the suite holds open and
// rolls back. Only the edges the job does not own are doubles: the mail
// provider, the identity lookup, the scope resolvers, access and work-state
// checks, the clock and the logger. Every double answers "deliverable" until a
// test says otherwise.

import { seedProperty } from '#/shared/db/testing/notification-test-db'
import { vi } from 'vitest'
import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  notificationEmailQueue,
  notificationPropertyDeliveryWindows,
  notificationUnsubscribeScopes,
  notifications,
} from '#/shared/db/schema'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import {
  createSendEmailsHandler,
  type SendEmailJobData,
  type SendEmailsDeps,
} from './send-emails.job'
import { createFakeJobLogger, waitingWorkState } from './test-fixtures'
import {
  emailIdOf,
  notificationIdOf,
  readEmail,
  seedNotice,
  type NoticeSeed,
  type SeededNotice,
} from './delivery-seed'
import type { NotificationDeliveryOutcome } from '../../domain/notification-delivery-policy'
import type { EmailSendRequest } from '../../application/ports/email-sender.port'

export const NOW = new Date('2026-01-15T15:00:00.000Z')
export const ORG = 'send-emails-org'
export const USER = 'send-emails-user'
export const PROPERTY = '11111111-1111-4111-8111-111111111111'
export const BASE_URL = 'https://app.example.com'
export const ADDRESS = 'manager@example.com'
const EMAIL_ADDRESS_KEYS = { emailAddressKey: 'send-emails-test-address-key' }
export const HOUR_MS = 60 * 60_000
const NAME = 'urgent'

export const acceptedOutcome = (acceptedAt: Date = NOW): NotificationDeliveryOutcome => ({
  kind: 'accepted',
  providerMessageId: 'provider-1',
  acceptedAt,
})

/** The job's collaborators over `db`; every non-database edge is a double. */
export function sendEmailsDeps(db: Database, now: Date = NOW) {
  const send = vi.fn(
    async (_params: EmailSendRequest): Promise<NotificationDeliveryOutcome> =>
      acceptedOutcome(now),
  )
  return {
    db,
    emailAddressKeys: EMAIL_ADDRESS_KEYS,
    userLookup: {
      getEmail: vi.fn(async (_user?: unknown): Promise<string | null> => ADDRESS),
    },
    emailSender: { send },
    resolvePropertyScope: vi.fn(
      async (
        _org?: string,
        _property?: string,
      ): Promise<{
        organizationId: string
        propertyId: string
        timezone: string
      } | null> => ({
        organizationId: ORG,
        propertyId: PROPERTY,
        timezone: 'America/New_York',
      }),
    ),
    resolveOrganizationScope: vi.fn(async (_org?: string) => ({
      timezone: 'Europe/London',
      propertyNames: new Map([[PROPERTY, 'Riverside Hotel']]),
    })),
    authorizeScope: vi.fn(async (_org: string, _property?: string) => true),
    isRecipientEligible: vi.fn(async (_input: unknown) => true),
    workState: waitingWorkState(),
    logger: createFakeJobLogger(),
    clock: () => now,
    baseUrl: BASE_URL as string,
    oneClickUnsubscribeUrl: vi.fn(
      (target: { kind: string; id: string }) =>
        `${BASE_URL}/api/notifications/unsubscribe?token=${target.kind}-${target.id}`,
    ),
  }
}

export type SendEmailsTestDeps = ReturnType<typeof sendEmailsDeps>

export const handlerFor = (deps: SendEmailsTestDeps) =>
  createSendEmailsHandler(deps as unknown as SendEmailsDeps)

/** The job message for one queue row; an Organization notice has no Property. */
export const jobFor = (
  emailId: string,
  options: Readonly<{ propertyId?: string; organizationId?: string }> = {
    propertyId: PROPERTY,
  },
): Job<SendEmailJobData> =>
  ({
    data: {
      notificationEmailId: emailId,
      organizationId: options.organizationId ?? ORG,
      ...(options.propertyId === undefined ? {} : { propertyId: options.propertyId }),
      capability: 'notification.send_email',
      policyVersionAtEnqueue: 'test',
      initiator: { kind: 'system', id: 'test' },
    },
  }) as unknown as Job<SendEmailJobData>

export type SendWorldOptions = Readonly<{
  /** Overrides for the notice; a `null` Property makes it an Organization notice. */
  notice?: Partial<Omit<NoticeSeed, 'name' | 'organizationId' | 'userId'>>
  now?: Date
}>

export type SendWorld = Readonly<{
  held: HeldTransaction
  db: Database
  notice: SeededNotice
  /** The key the provider sees for this row. */
  idempotencyKey: string
  job: Job<SendEmailJobData>
  deps: () => SendEmailsTestDeps
  run: (deps: SendEmailsTestDeps, job?: Job<SendEmailJobData>) => Promise<void>
  email: () => ReturnType<typeof readEmail>
  setEmail: (values: Partial<typeof notificationEmailQueue.$inferInsert>) => Promise<void>
  setNotice: (values: Partial<typeof notifications.$inferInsert>) => Promise<void>
  unsubscribeScopes: () => Promise<(typeof notificationUnsubscribeScopes.$inferSelect)[]>
  rollBack: () => Promise<void>
}>

/** An urgent, immediate email for a Property, queued ten minutes before `now`. */
export async function openSendWorld(options: SendWorldOptions = {}): Promise<SendWorld> {
  const held = await holdTransaction()
  const { db } = held
  const now = options.now ?? NOW
  await seedProperty(db, { id: PROPERTY, organizationId: ORG, name: 'Riverside Hotel' })
  const propertyId =
    options.notice?.propertyId === undefined ? PROPERTY : options.notice.propertyId
  const { email: emailOverrides, ...noticeOverrides } = options.notice ?? {}
  const notice = await seedNotice(db, {
    createdAt: new Date(now.getTime() - 10 * 60_000),
    type: 'reply.publish_failed',
    category: 'urgent_operational',
    priority: 'urgent',
    resourceType: 'reply',
    resourceId: 'reply-1',
    payload: { propertyName: 'Riverside Hotel', platform: 'google', waitingHours: 5 },
    title: 'Reply publication failed 61ed98fc-1c2b-4d6e-9f00-000000000001',
    ...noticeOverrides,
    name: NAME,
    organizationId: ORG,
    userId: USER,
    propertyId,
    email: { cadence: 'immediate', ...emailOverrides },
  })
  const queued = jobFor(emailIdOf(NAME), propertyId === null ? {} : { propertyId })
  return {
    held,
    db,
    notice,
    idempotencyKey: `${notificationIdOf(NAME)}:email`,
    job: queued,
    deps: () => sendEmailsDeps(db, now),
    run: (deps, job) => handlerFor(deps)(job ?? queued),
    email: () => readEmail(db, emailIdOf(NAME)),
    setEmail: async (values) => {
      await db
        .update(notificationEmailQueue)
        .set(values)
        .where(eq(notificationEmailQueue.id, emailIdOf(NAME)))
    },
    setNotice: async (values) => {
      await db
        .update(notifications)
        .set(values)
        .where(eq(notifications.id, notificationIdOf(NAME)))
    },
    unsubscribeScopes: () => db.select().from(notificationUnsubscribeScopes),
    rollBack: () => held.rollBack(),
  }
}

/** The person's own quiet hours for the Property, with no settings row of their own. */
export async function seedPropertyWindow(
  db: Database,
  input: Readonly<{
    quietHoursStart: string
    quietHoursEnd: string
    urgentBypassEnabled?: boolean
  }>,
): Promise<void> {
  await db.insert(notificationPropertyDeliveryWindows).values({
    userId: USER,
    organizationId: ORG,
    propertyId: PROPERTY,
    quietHoursStart: input.quietHoursStart,
    quietHoursEnd: input.quietHoursEnd,
    urgentBypassEnabled: input.urgentBypassEnabled ?? false,
  })
}
