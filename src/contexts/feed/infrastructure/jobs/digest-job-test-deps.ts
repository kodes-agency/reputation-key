// The digest job against real PostgreSQL, shared by its focused test files.
// Queue rows, notifications, settings, preferences, batches and the refused-
// address list are real rows in a transaction the suite holds open and rolls
// back. Only the edges the job does not own are doubles: the mail provider,
// the identity lookup, the Property and Organization scope resolvers, access
// and work-state checks, the clock and the id generator. Every double answers
// "deliverable" until a test says otherwise.

import { vi } from 'vitest'
import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import type { Database } from '#/shared/db'
import { notificationDigestBatches, notificationEmailQueue } from '#/shared/db/schema'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import {
  createDigestNotificationJobHandler,
  type DigestDeps,
} from './digest-notification.job'
import { createFakeJobLogger, waitingWorkState } from './test-fixtures'
import {
  emailIdOf,
  readEmail,
  seedEmailPreferenceIfAbsent,
  seedNotice,
  seedUserSettings,
  stableUuid,
  type SeededNotice,
} from './delivery-seed'
import { seedProperty } from '#/shared/db/testing/notification-test-db'
import type { EmailSendRequest } from '../../application/ports/email-sender.port'
import type { NotificationDeliveryOutcome } from '../../domain/notification-delivery-policy'

export const ORG = 'digest-job-org'
export const USER = 'digest-job-user-1'
export const USER_2 = 'digest-job-user-2'
export const PROP_A = '11111111-1111-4111-8111-111111111111'
export const PROP_B = '22222222-2222-4222-8222-222222222222'
const BASE_URL = 'https://app.example.com'
// 08:00 UTC — inside the digest window for a UTC recipient.
export const NOW = new Date('2026-07-11T08:00:00.000Z')
export const HOUR = 60 * 60_000
const EMAIL_ADDRESS_KEYS = { emailAddressKey: 'digest-job-test-address-key' }

const PROPERTY_NAMES: Record<string, string> = {
  [PROP_A]: 'Riverside',
  [PROP_B]: 'Hillcrest',
}

export type DigestEntryOptions = Readonly<{
  property: string
  user?: string
  status?: string
  createdAt?: Date
  notBefore?: Date | null
  type?: string
  category?: string
  resourceType?: string
  resolvedAt?: Date | null
  withNotification?: boolean
}>

export type DigestEntry = SeededNotice &
  Readonly<{ property: string; user: string; name: string }>

export type DigestTestOptions = Readonly<{
  now?: Date
  orgTimezone?: string | null
  activeUnsubscribeKeyVersion?: string
}>

export type DigestTestDeps = ReturnType<typeof digestDeps>

const outcomeAccepted = (now: Date): NotificationDeliveryOutcome => ({
  kind: 'accepted',
  providerMessageId: crypto.randomUUID(),
  acceptedAt: now,
})

/** The job's collaborators over `db`; every non-database edge is a double. */
function digestDeps(held: HeldTransaction, options: DigestTestOptions = {}) {
  const now = options.now ?? NOW
  let batchSerial = 0
  const send = vi.fn(
    async (_params: EmailSendRequest): Promise<NotificationDeliveryOutcome> =>
      outcomeAccepted(now),
  )
  return {
    // The held connection, so raw queries see the rows the suite wrote.
    pool: held.client as unknown as Pool,
    db: held.db,
    emailAddressKeys: EMAIL_ADDRESS_KEYS,
    userLookup: {
      getEmail: vi.fn(
        async (_user?: unknown): Promise<string | null> => 'manager@example.com',
      ),
      getName: vi.fn(async (_user?: unknown): Promise<string | null> => 'Alex'),
    },
    emailSender: { send },
    resolveOrganizationScope: vi.fn(async (_org?: string) => ({
      timezone: options.orgTimezone === undefined ? 'UTC' : options.orgTimezone,
      propertyNames: new Map(Object.entries(PROPERTY_NAMES)),
    })),
    logger: createFakeJobLogger(),
    clock: () => now,
    batchIdGen: vi.fn(() => stableUuid('digest-batch', String(++batchSerial))),
    resolvePropertyScope: vi.fn(async (org: string, property: string) => ({
      organizationId: org,
      propertyId: property,
      timezone: 'UTC',
    })) as DigestDeps['resolvePropertyScope'] & ReturnType<typeof vi.fn>,
    authorizeScope: vi.fn(async (_org: string, _property?: string) => true),
    authorizeMandatoryScope: vi.fn(async (_org: string) => true),
    isRecipientEligible: vi.fn(
      async (_input: { propertyId: string; audience: unknown }, _memo?: unknown) => true,
    ),
    workState: waitingWorkState(),
    baseUrl: BASE_URL,
    activeOneClickUnsubscribeKeyVersion: vi.fn(
      () => options.activeUnsubscribeKeyVersion ?? 'v1',
    ),
    oneClickUnsubscribeUrl: vi.fn(
      (target: { kind: string; id: string }, keyVersion: string) =>
        `${BASE_URL}/api/notifications/unsubscribe?token=${keyVersion}-${target.kind}-${target.id}`,
    ),
    enqueueImmediate: vi.fn(async (_target: unknown) => {}),
  }
}

const runDigest = (deps: DigestTestDeps) =>
  createDigestNotificationJobHandler(deps as unknown as DigestDeps)({} as Job<void>)

export type DigestWorld = Readonly<{
  held: HeldTransaction
  db: Database
  /** The rows seeded for Riverside and Hillcrest, in that order. */
  entries: readonly DigestEntry[]
  entry: (options: DigestEntryOptions) => Promise<DigestEntry>
  deps: (options?: DigestTestOptions) => DigestTestDeps
  run: (deps: DigestTestDeps) => Promise<void>
  email: (entry: DigestEntry) => ReturnType<typeof readEmail>
  batches: () => Promise<(typeof notificationDigestBatches.$inferSelect)[]>
  setEmail: (
    entry: DigestEntry,
    values: Partial<typeof notificationEmailQueue.$inferInsert>,
  ) => Promise<void>
  rollBack: () => Promise<void>
}>

/**
 * A recipient due for a digest of two Properties, in UTC by default. Pass
 * `userTimezone: null` for a recipient who never chose a timezone.
 */
export async function openDigestWorld(
  options: Readonly<{
    userTimezone?: string | null
    entries?: boolean
    now?: Date
  }> = {},
): Promise<DigestWorld> {
  const held = await holdTransaction()
  const { db } = held
  const now = options.now ?? NOW
  for (const [id, name] of Object.entries(PROPERTY_NAMES)) {
    await seedProperty(db, { id, organizationId: ORG, name })
  }
  const timezone = options.userTimezone === undefined ? 'UTC' : options.userTimezone
  for (const user of [USER, USER_2]) {
    if (timezone !== null) {
      await seedUserSettings(db, { userId: user, organizationId: ORG, timezone })
    }
  }

  const entry = async (entryOptions: DigestEntryOptions): Promise<DigestEntry> => {
    const user = entryOptions.user ?? USER
    const name = `${entryOptions.property}-${user}`
    const category = entryOptions.category ?? 'recognition'
    await seedEmailPreferenceIfAbsent(db, {
      userId: user,
      organizationId: ORG,
      propertyId: entryOptions.property,
      category,
      enabled: true,
      cadence: 'daily',
      ...(category === 'low_ratings' ? { maxRating: 2 } : {}),
    })
    const seeded = await seedNotice(db, {
      name,
      organizationId: ORG,
      userId: user,
      propertyId: entryOptions.property,
      createdAt: entryOptions.createdAt ?? new Date(now.getTime() - HOUR),
      type: entryOptions.type ?? 'goal.completed',
      category,
      resourceType: entryOptions.resourceType ?? 'goal',
      resourceId: `goal-${entryOptions.property}`,
      payload: {
        propertyName: PROPERTY_NAMES[entryOptions.property],
        goalName: 'Reply within 24h',
      },
      title: 'Goal 61ed98fc-1c2b-4d6e-9f00-000000000001',
      resolvedAt: entryOptions.resolvedAt,
      withNotification: entryOptions.withNotification,
      email: {
        cadence: 'daily',
        status: entryOptions.status,
        notBefore: entryOptions.notBefore,
      },
    })
    return { ...seeded, property: entryOptions.property, user, name }
  }

  const entries =
    options.entries === false
      ? []
      : [await entry({ property: PROP_A }), await entry({ property: PROP_B })]

  return {
    held,
    db,
    entries,
    entry,
    deps: (depsOptions) => digestDeps(held, { now, ...depsOptions }),
    run: runDigest,
    email: (target) => readEmail(db, emailIdOf(target.name)),
    batches: () => db.select().from(notificationDigestBatches),
    setEmail: async (target, values) => {
      await db
        .update(notificationEmailQueue)
        .set(values)
        .where(eq(notificationEmailQueue.id, target.emailId))
    },
    rollBack: () => held.rollBack(),
  }
}
