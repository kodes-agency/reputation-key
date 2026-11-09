import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  notificationCategoryDefaults,
  notificationPreferences,
  properties,
} from '#/shared/db/schema'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { organizationId, userId } from '#/shared/domain/ids'
import { NOTIFICATION_SETTINGS_CATEGORIES } from '../domain/notification-delivery-policy'
import type { NotificationCategoryDefault } from '../domain/notification-types'
import { createNotificationPreferenceRepository } from '../infrastructure/repositories/notification-preference.repository'
import {
  copyCategoryDefaultsToPreferences,
  countCategoryDefaultsToCopy,
} from './copy-category-defaults.server'

const ORG_A = 'pref-rows-org-a'
const ORG_B = 'pref-rows-org-b'
const BOTH = 'pref-rows-user-both'
const NONE = 'pref-rows-user-none'
const ONLY_A = 'pref-rows-user-only-a'
const USERS = [BOTH, NONE, ONLY_A]
const P1 = '85000000-0000-4000-8000-000000000001'
const P2 = '85000000-0000-4000-8000-000000000002'
const P3 = '85000000-0000-4000-8000-000000000003'
const CREATED = new Date('2026-09-01T08:00:00.000Z')
const CHANGED = new Date('2026-09-02T08:00:00.000Z')

type Seed = Readonly<{
  user: string
  org: string
  category: string
  channel: 'in_app' | 'email'
  enabled: boolean
  cadence: 'immediate' | 'daily'
  maxRating?: number
}>

const DEFAULTS: readonly Seed[] = [
  {
    user: BOTH,
    org: ORG_A,
    category: 'low_ratings',
    channel: 'email',
    enabled: true,
    cadence: 'immediate',
    maxRating: 3,
  },
  {
    user: BOTH,
    org: ORG_A,
    category: 'arrivals',
    channel: 'email',
    enabled: true,
    cadence: 'immediate',
  },
  {
    user: BOTH,
    org: ORG_A,
    category: 'workflow_collaboration',
    channel: 'in_app',
    enabled: false,
    cadence: 'daily',
  },
  {
    user: BOTH,
    org: ORG_A,
    category: 'recognition',
    channel: 'email',
    enabled: true,
    cadence: 'daily',
  },
  {
    user: BOTH,
    org: ORG_B,
    category: 'arrivals',
    channel: 'email',
    enabled: false,
    cadence: 'daily',
  },
  {
    user: BOTH,
    org: ORG_B,
    category: 'workflow_collaboration',
    channel: 'in_app',
    enabled: true,
    cadence: 'immediate',
  },
  {
    user: ONLY_A,
    org: ORG_A,
    category: 'guest_voice',
    channel: 'email',
    enabled: true,
    cadence: 'daily',
  },
]

const OVERRIDES: ReadonlyArray<Seed & { property: string }> = [
  {
    user: BOTH,
    org: ORG_A,
    property: P1,
    category: 'arrivals',
    channel: 'email',
    enabled: false,
    cadence: 'daily',
  },
  {
    user: BOTH,
    org: ORG_A,
    property: P1,
    category: 'low_ratings',
    channel: 'email',
    enabled: true,
    cadence: 'daily',
    maxRating: 2,
  },
  {
    user: BOTH,
    org: ORG_B,
    property: P3,
    category: 'workflow_collaboration',
    channel: 'in_app',
    enabled: false,
    cadence: 'immediate',
  },
]

const PLACES: ReadonlyArray<readonly [string, string, string]> = [
  [BOTH, ORG_A, P1],
  [BOTH, ORG_A, P2],
  [BOTH, ORG_B, P3],
  [NONE, ORG_A, P1],
  [NONE, ORG_B, P3],
  [ONLY_A, ORG_A, P2],
]

describe.sequential('category defaults as preference rows (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const clean = async () => {
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
        channel: row.channel,
        enabled: row.enabled,
        cadence: row.cadence,
        maxRating: row.maxRating ?? null,
        createdAt: CREATED,
        updatedAt: CREATED,
      })),
    )
    await db.insert(notificationPreferences).values(
      OVERRIDES.map((row) => ({
        userId: row.user,
        organizationId: row.org,
        propertyId: row.property,
        category: row.category,
        channel: row.channel,
        enabled: row.enabled,
        cadence: row.cadence,
        maxRating: row.maxRating ?? null,
        createdAt: CREATED,
        updatedAt: CREATED,
      })),
    )
  }

  // Every answer the product reads: delivery resolution for each user,
  // Property, category and channel, and each person's defaults as listed.
  const resolveEverything = async () => {
    const repo = createNotificationPreferenceRepository(db)
    const resolved: Record<string, unknown> = {}
    for (const [user, org, property] of PLACES) {
      for (const category of NOTIFICATION_SETTINGS_CATEGORIES) {
        for (const channel of ['in_app', 'email']) {
          resolved[`${user}/${org}/${property}/${category}/${channel}`] =
            await repo.resolveForDelivery(user, org, property, category, channel)
        }
      }
    }
    const listed: Record<string, unknown> = {}
    for (const [user, org] of [
      [BOTH, ORG_A],
      [BOTH, ORG_B],
      [NONE, ORG_A],
      [ONLY_A, ORG_A],
    ] as const) {
      const rows = await repo.findCategoryDefaults(userId(user), organizationId(org))
      listed[`${user}/${org}`] = rows
        .map((row) => ({ ...row }))
        .sort((a, b) =>
          `${a.category}${a.channel}`.localeCompare(`${b.category}${b.channel}`),
        )
    }
    const own = await repo.findByUser(userId(BOTH), organizationId(ORG_A))
    return {
      resolved,
      listed,
      ownRows: own
        .map(({ id: _id, ...rest }) => rest)
        .sort((a, b) =>
          `${a.category}${a.channel}`.localeCompare(`${b.category}${b.channel}`),
        ),
    }
  }

  const mirrorRows = () =>
    db
      .select()
      .from(notificationPreferences)
      .where(inArray(notificationPreferences.userId, USERS))
      .then((rows) => rows.filter((row) => row.propertyId === null))

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    for (const id of [P1, P2, P3])
      await db.delete(properties).where(eq(properties.id, id))
    await db.insert(properties).values([
      {
        id: P1,
        organizationId: ORG_A,
        name: 'Rows One',
        slug: 'pref-rows-one',
        timezone: 'UTC',
      },
      {
        id: P2,
        organizationId: ORG_A,
        name: 'Rows Two',
        slug: 'pref-rows-two',
        timezone: 'UTC',
      },
      {
        id: P3,
        organizationId: ORG_B,
        name: 'Rows Three',
        slug: 'pref-rows-three',
        timezone: 'UTC',
      },
    ])
  })

  beforeEach(clean)

  afterAll(async () => {
    await clean()
    for (const id of [P1, P2, P3])
      await db?.delete(properties).where(eq(properties.id, id))
    await lease?.release()
  })

  it('resolves every category the same before the copy, after it and after the cutover', async () => {
    await seed()
    const before = await resolveEverything()
    expect(Object.keys(before.resolved)).toHaveLength(
      PLACES.length * NOTIFICATION_SETTINGS_CATEGORIES.length * 2,
    )
    expect(await mirrorRows()).toHaveLength(0)

    const copied = await copyCategoryDefaultsToPreferences(db, { batchSize: 2 })
    expect(copied).toEqual({ inserted: DEFAULTS.length, updated: 0 })
    expect(await mirrorRows()).toHaveLength(DEFAULTS.length)
    expect(await resolveEverything()).toEqual(before)

    // Reads now come from the preference rows alone.
    await db
      .delete(notificationCategoryDefaults)
      .where(inArray(notificationCategoryDefaults.userId, USERS))
    expect(await resolveEverything()).toEqual(before)
  })

  it('changes nothing when the copy runs again', async () => {
    await seed()
    await copyCategoryDefaultsToPreferences(db)
    const first = await mirrorRows()

    await expect(countCategoryDefaultsToCopy(db)).resolves.toEqual({
      missing: 0,
      differing: 0,
    })
    await expect(copyCategoryDefaultsToPreferences(db)).resolves.toEqual({
      inserted: 0,
      updated: 0,
    })
    expect(await mirrorRows()).toEqual(first)
  })

  it('brings a copy left behind by an older release up to date', async () => {
    await seed()
    await copyCategoryDefaultsToPreferences(db)
    await db
      .update(notificationCategoryDefaults)
      .set({ enabled: false, cadence: 'daily', updatedAt: CHANGED })
      .where(eq(notificationCategoryDefaults.category, 'arrivals'))
    await expect(countCategoryDefaultsToCopy(db)).resolves.toEqual({
      missing: 0,
      differing: 1,
    })

    await expect(copyCategoryDefaultsToPreferences(db)).resolves.toEqual({
      inserted: 0,
      updated: 1,
    })
    const stale = (await mirrorRows()).filter(
      (row) => row.category === 'arrivals' && row.organizationId === ORG_A,
    )
    expect(stale.map((row) => [row.enabled, row.cadence])).toEqual([[false, 'daily']])
  })

  it('reads a newer answer in the earlier table over a stale copy, with no rerun', async () => {
    await seed()
    await copyCategoryDefaultsToPreferences(db)
    const repo = createNotificationPreferenceRepository(db)
    // A previous release saves a default and writes only the earlier table.
    await db
      .update(notificationCategoryDefaults)
      .set({ enabled: false, cadence: 'daily', updatedAt: CHANGED })
      .where(
        and(
          eq(notificationCategoryDefaults.userId, ONLY_A),
          eq(notificationCategoryDefaults.category, 'guest_voice'),
        ),
      )

    await expect(
      repo.resolveForDelivery(ONLY_A, ORG_A, P2, 'guest_voice', 'email'),
    ).resolves.toMatchObject({ enabled: false })
    const listed = await repo.findCategoryDefaults(userId(ONLY_A), organizationId(ORG_A))
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ enabled: false, cadence: 'daily' })

    // After the copy the two agree again.
    await copyCategoryDefaultsToPreferences(db)
    await expect(
      repo.resolveForDelivery(ONLY_A, ORG_A, P2, 'guest_voice', 'email'),
    ).resolves.toMatchObject({ enabled: false })
  })

  it('refuses a batch size outside its bounds', async () => {
    await expect(copyCategoryDefaultsToPreferences(db, { batchSize: 0 })).rejects.toThrow(
      /batch size/,
    )
  })

  it('lands a save through the settings path in both places', async () => {
    const repo = createNotificationPreferenceRepository(db)
    const answer: NotificationCategoryDefault = {
      userId: userId(BOTH),
      organizationId: organizationId(ORG_A),
      category: 'low_ratings',
      channel: 'email',
      enabled: true,
      cadence: 'immediate',
      maxRating: 3,
      createdAt: CREATED,
      updatedAt: CREATED,
    }
    await repo.saveCategoryDefault(answer, P1)
    await repo.saveCategoryDefault({ ...answer, maxRating: 4, updatedAt: CHANGED }, P1)

    const earlier = await db
      .select()
      .from(notificationCategoryDefaults)
      .where(eq(notificationCategoryDefaults.userId, BOTH))
    const mirror = await mirrorRows()
    expect(earlier).toHaveLength(1)
    expect(mirror).toHaveLength(1)
    expect(mirror[0]).toMatchObject({
      organizationId: ORG_A,
      category: 'low_ratings',
      channel: 'email',
      enabled: true,
      cadence: 'immediate',
      maxRating: 4,
      updatedAt: CHANGED,
    })
    expect(earlier[0]).toMatchObject({ maxRating: 4, updatedAt: CHANGED })
    await expect(countCategoryDefaultsToCopy(db)).resolves.toEqual({
      missing: 0,
      differing: 0,
    })
  })

  it('keeps Organization defaults out of the per-Property rows', async () => {
    await seed()
    await copyCategoryDefaultsToPreferences(db)
    const repo = createNotificationPreferenceRepository(db)
    const own = await repo.findByUser(userId(BOTH), organizationId(ORG_A))
    expect(own).toHaveLength(2)
    expect(own.every((row) => row.propertyId !== null)).toBe(true)
    const nullRows = await db
      .select()
      .from(notificationPreferences)
      .where(isNull(notificationPreferences.propertyId))
    expect(nullRows.length).toBeGreaterThanOrEqual(DEFAULTS.length)
  })
})
