// Shared test fixtures for the insert-notification use case: the use case's
// deps over a real database, with doubles only for the edges Feed does not own.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  notificationEmailQueue,
  notificationPreferences,
  notifications,
} from '#/shared/db/schema'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { seedProperty } from '#/shared/db/testing/notification-test-db'
import type { NotificationCategory } from '../domain/notification-types'
import type {
  InsertNotificationDeps,
  InsertNotificationInput,
} from './insert-notification.server'
import {
  notificationId,
  notificationEmailId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'

const FIXED_DATE = new Date('2026-06-10T10:00:00Z')

/**
 * {@link InsertNotificationDeps} writing to `db`. Ids are fresh UUIDs, the
 * clock is fixed, and the rating lookup, queued-email callback and logger
 * are doubles.
 */
export function buildInsertNotificationDeps(
  db: InsertNotificationDeps['db'],
): InsertNotificationDeps {
  return {
    db,
    clock: () => FIXED_DATE,
    idGen: () => notificationId(randomUUID()),
    emailIdGen: () => notificationEmailId(randomUUID()),
    ratingForRouting: vi.fn(async () => null),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  }
}

type Channel = 'in_app' | 'email'

/** One stored preference answer for the reader of a harness. */
export type StoredAnswer = Readonly<{
  category: NotificationCategory
  channel: Channel
  enabled: boolean
  cadence?: 'immediate' | 'daily'
  maxRating?: 1 | 2 | 3 | 4
}>

/** The reader's Low ratings answers: how low each channel goes, and how it is sent. */
export const lowRatings = (
  inApp: Readonly<{ enabled: boolean; maxRating: 1 | 2 | 3 | 4 }>,
  email: Readonly<{ enabled: boolean; maxRating: 1 | 2 | 3 | 4 }>,
): ReadonlyArray<StoredAnswer> => [
  { category: 'low_ratings', channel: 'in_app', cadence: 'immediate', ...inApp },
  { category: 'low_ratings', channel: 'email', cadence: 'immediate', ...email },
]

/**
 * A suite over one held transaction holding a Property, a reader and a rolled
 * back set of notice rows. Call at the top of a test file: it registers the
 * file's hooks. Suites that run in parallel use distinct ids.
 */
export function useInsertNotificationHarness(ids: {
  readonly orgId: OrganizationId
  readonly propertyId: PropertyId
  readonly userId: UserId
}) {
  const { orgId, propertyId: propId, userId: reader } = ids
  let held: HeldTransaction
  let deps: InsertNotificationDeps

  beforeAll(async () => {
    held = await holdTransaction()
    await seedProperty(held.db, { id: propId, organizationId: orgId })
  })
  afterAll(async () => {
    await held?.rollBack()
  })
  beforeEach(async () => {
    await held.db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, orgId))
    await held.db.delete(notifications).where(eq(notifications.organizationId, orgId))
    await held.db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.organizationId, orgId))
    deps = buildInsertNotificationDeps(held.db)
  })

  /** A notice for the reader, Property and inbox item; overrides win. */
  const notice = (
    type: InsertNotificationInput['type'],
    overrides: Partial<InsertNotificationInput> = {},
  ): InsertNotificationInput =>
    ({
      userId: reader,
      organizationId: orgId,
      propertyId: propId,
      type,
      resourceType: 'inbox_item',
      resourceId: 'item-1',
      eventId: 'event-1',
      ...overrides,
    }) as InsertNotificationInput

  return {
    ids,
    notice,
    // A workflow notice: on in the app by default. An arrival (a new review) is
    // off by default (D4), so it would test the skip, not the write.
    input: notice('inbox_note.added', {
      payload: { propertyName: 'Riverside Hotel', platform: 'google' },
    }),
    get held() {
      return held
    },
    get deps() {
      return deps
    },
    seed: async (...answers: ReadonlyArray<StoredAnswer>) => {
      if (answers.length === 0) return
      await held.db.insert(notificationPreferences).values(
        answers.map((answer) => ({
          userId: reader,
          organizationId: orgId,
          propertyId: propId,
          category: answer.category,
          channel: answer.channel,
          enabled: answer.enabled,
          cadence: answer.cadence ?? 'daily',
          maxRating: answer.maxRating ?? null,
        })),
      )
    },
    noticeRows: () =>
      held.db.select().from(notifications).where(eq(notifications.organizationId, orgId)),
    emailRows: () =>
      held.db
        .select()
        .from(notificationEmailQueue)
        .where(eq(notificationEmailQueue.organizationId, orgId)),
    noticeById: async (id: string) =>
      (await held.db.select().from(notifications).where(eq(notifications.id, id)))[0],
  }
}
