// In-app visibility against PostgreSQL: an email-only notice is hidden from the
// feed and the badge while the reader has in-app off for that Property and
// category. The answer is the Property's own row, else the person's
// Organization default (a preference row with no Property, else the category
// defaults table), else the versioned default. The hidden set must be the same
// before the defaults are copied into preference rows, after the copy, and once
// the old table is empty.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  notificationCategoryDefaults,
  notificationPreferences,
  notifications,
  properties,
} from '#/shared/db/schema'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { copyCategoryDefaultsToPreferences } from '../../preferences/copy-category-defaults.server'
import { createNotificationRepository } from './notification.repository'

const ORG = 'in-app-vis-org'
const OTHER_ORG = 'in-app-vis-other-org'
const READER = 'in-app-vis-reader'
const BARE = 'in-app-vis-bare'
const USERS = [READER, BARE]
const P1 = '86000000-0000-4000-8000-000000000001'
const P2 = '86000000-0000-4000-8000-000000000002'
const P3 = '86000000-0000-4000-8000-000000000003'
const CREATED = new Date('2026-09-01T08:00:00.000Z')

type Setting = Readonly<{
  user: string
  org: string
  category: string
  property?: string
  enabled: boolean
}>

// Organization defaults in the category defaults table.
const DEFAULTS: readonly Setting[] = [
  { user: READER, org: ORG, category: 'workflow_collaboration', enabled: false },
  { user: READER, org: ORG, category: 'arrivals', enabled: true },
  { user: READER, org: ORG, category: 'recognition', enabled: true },
  // Another Organization turns on a category this one leaves at its default (off).
  { user: READER, org: OTHER_ORG, category: 'guest_voice', enabled: true },
]

// Property overrides: they win over any default.
const OVERRIDES: readonly Setting[] = [
  {
    user: READER,
    org: ORG,
    category: 'workflow_collaboration',
    property: P1,
    enabled: true,
  },
  { user: READER, org: ORG, category: 'arrivals', property: P1, enabled: false },
  { user: READER, org: ORG, category: 'recognition', property: P1, enabled: false },
]

// One email-only notice per (user, Property, category). `shown` is what the
// reader sees today: the Property row, else the default, else the versioned
// default (on, except arrivals and guest voice).
const NOTICES: ReadonlyArray<
  Readonly<{ user: string; property: string; category: string; shown: boolean }>
> = [
  { user: READER, property: P1, category: 'workflow_collaboration', shown: true },
  { user: READER, property: P2, category: 'workflow_collaboration', shown: false },
  { user: READER, property: P1, category: 'arrivals', shown: false },
  { user: READER, property: P2, category: 'arrivals', shown: true },
  { user: READER, property: P1, category: 'recognition', shown: false },
  { user: READER, property: P2, category: 'recognition', shown: true },
  { user: READER, property: P2, category: 'guest_voice', shown: false },
  { user: BARE, property: P2, category: 'workflow_collaboration', shown: true },
  { user: BARE, property: P2, category: 'arrivals', shown: false },
]

const resourceOf = (n: (typeof NOTICES)[number]) =>
  `${n.user}/${n.property}/${n.category}`

describe.sequential('in-app visibility of notices (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const clean = async () => {
    await db.delete(notifications).where(inArray(notifications.userId, USERS))
    await db
      .delete(notificationCategoryDefaults)
      .where(inArray(notificationCategoryDefaults.userId, USERS))
    await db
      .delete(notificationPreferences)
      .where(inArray(notificationPreferences.userId, USERS))
  }

  const seed = async () => {
    await db.insert(notificationCategoryDefaults).values(
      DEFAULTS.map((row) => ({
        userId: row.user,
        organizationId: row.org,
        category: row.category,
        channel: 'in_app',
        enabled: row.enabled,
        cadence: 'immediate',
        createdAt: CREATED,
        updatedAt: CREATED,
      })),
    )
    await db.insert(notificationPreferences).values(
      OVERRIDES.map((row) => ({
        userId: row.user,
        organizationId: row.org,
        propertyId: row.property!,
        category: row.category,
        channel: 'in_app',
        enabled: row.enabled,
        cadence: 'immediate',
        createdAt: CREATED,
        updatedAt: CREATED,
      })),
    )
    await db.insert(notifications).values(
      NOTICES.map((notice) => ({
        userId: notice.user,
        organizationId: ORG,
        propertyId: notice.property,
        type: 'review.created',
        category: notice.category,
        // An email-only arrival anchor: delivered by email, listed in the app
        // only while in-app is on for it.
        status: 'read',
        readAt: CREATED,
        resourceType: 'inbox_item',
        resourceId: resourceOf(notice),
        eventId: `event/${resourceOf(notice)}`,
        title: 'Notice',
        createdAt: CREATED,
      })),
    )
  }

  const listedFor = async (user: string): Promise<string[]> => {
    const repo = createNotificationRepository(db)
    const head = await repo.readFeedHead({
      userId: user,
      organizationId: ORG,
      visiblePropertyIds: null,
      filter: 'all',
      limit: 50,
    })
    return head.page.notifications.map((n) => n.resourceId).sort()
  }

  const expectedFor = (user: string) =>
    NOTICES.filter((n) => n.user === user && n.shown)
      .map(resourceOf)
      .sort()

  const expectToday = async () => {
    for (const user of USERS) expect(await listedFor(user)).toEqual(expectedFor(user))
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    for (const id of [P1, P2, P3])
      await db.delete(properties).where(eq(properties.id, id))
    await db.insert(properties).values(
      [P1, P2, P3].map((id, index) => ({
        id,
        organizationId: ORG,
        name: `Visibility ${index + 1}`,
        slug: `in-app-vis-${index + 1}`,
        timezone: 'UTC',
      })),
    )
  })

  beforeEach(async () => {
    await clean()
    await seed()
  })

  afterAll(async () => {
    await clean()
    for (const id of [P1, P2, P3])
      await db?.delete(properties).where(eq(properties.id, id))
    await lease?.release()
  })

  it('hides the notices the reader opted out of with only the old table', async () => {
    await expectToday()
  })

  it('hides the same notices after the defaults are copied', async () => {
    await copyCategoryDefaultsToPreferences(db)
    await expectToday()
  })

  it('hides the same notices once the old table is empty', async () => {
    await copyCategoryDefaultsToPreferences(db)
    await db
      .delete(notificationCategoryDefaults)
      .where(inArray(notificationCategoryDefaults.userId, USERS))
    await expectToday()
  })

  it('counts the same unread notices in every state', async () => {
    const unread = async () => {
      const repo = createNotificationRepository(db)
      const head = await repo.readFeedHead({
        userId: READER,
        organizationId: ORG,
        visiblePropertyIds: null,
        filter: 'unread',
        limit: 50,
      })
      return head.unreadCount
    }
    await db
      .update(notifications)
      .set({ status: 'unread', readAt: null })
      .where(inArray(notifications.userId, USERS))
    const before = await unread()
    expect(before).toBe(expectedFor(READER).length)
    await copyCategoryDefaultsToPreferences(db)
    expect(await unread()).toBe(before)
    await db
      .delete(notificationCategoryDefaults)
      .where(inArray(notificationCategoryDefaults.userId, USERS))
    expect(await unread()).toBe(before)
  })

  it('lets the Property override beat the new default row, which beats the old table', async () => {
    await copyCategoryDefaultsToPreferences(db)
    // The old table now disagrees with the copied row: the copied row answers.
    await db
      .update(notificationCategoryDefaults)
      .set({ enabled: true })
      .where(eq(notificationCategoryDefaults.category, 'workflow_collaboration'))
    expect(await listedFor(READER)).toEqual(expectedFor(READER))

    // A Property override still wins over a changed default row.
    await db
      .update(notificationPreferences)
      .set({ enabled: false })
      .where(eq(notificationPreferences.propertyId, P1))
    const hiddenOnP1 = (await listedFor(READER)).filter((id) =>
      id.startsWith(`${READER}/${P1}/`),
    )
    expect(hiddenOnP1).toEqual([])
  })

  it('ignores a default set in another Organization', async () => {
    await copyCategoryDefaultsToPreferences(db)
    expect(await listedFor(READER)).not.toContain(`${READER}/${P2}/guest_voice`)
  })
})
