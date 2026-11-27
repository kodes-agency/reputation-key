import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notificationPreferences, properties } from '#/shared/db/schema'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { organizationId, userId } from '#/shared/domain/ids'
import { NOTIFICATION_SETTINGS_CATEGORIES } from '../domain/notification-delivery-policy'
import type { NotificationCategoryDefault } from '../domain/notification-types'
import * as store from './notification-preferences.server'

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
      .delete(notificationPreferences)
      .where(inArray(notificationPreferences.userId, USERS))
  }

  const seed = async () => {
    await db.insert(notificationPreferences).values(
      DEFAULTS.map((row) => ({
        userId: row.user,
        organizationId: row.org,
        propertyId: null,
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
    const resolved: Record<string, unknown> = {}
    for (const [user, org, property] of PLACES) {
      for (const category of NOTIFICATION_SETTINGS_CATEGORIES) {
        for (const channel of ['in_app', 'email']) {
          resolved[`${user}/${org}/${property}/${category}/${channel}`] =
            await store.resolveForDelivery(db, user, org, property, category, channel)
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
      const rows = await store.findCategoryDefaults(db, userId(user), organizationId(org))
      listed[`${user}/${org}`] = rows
        .map((row) => ({ ...row }))
        .sort((a, b) =>
          `${a.category}${a.channel}`.localeCompare(`${b.category}${b.channel}`),
        )
    }
    const own = await store.findByUser(db, userId(BOTH), organizationId(ORG_A))
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

  it('resolves every category from the preference rows alone', async () => {
    await seed()
    expect(await mirrorRows()).toHaveLength(DEFAULTS.length)
    const before = await resolveEverything()
    expect(Object.keys(before.resolved)).toHaveLength(
      PLACES.length * NOTIFICATION_SETTINGS_CATEGORIES.length * 2,
    )
  })

  it('lands a save through the settings path in the preference row', async () => {
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
    await store.saveCategoryDefault(db, answer, P1)
    const saved = await store.saveCategoryDefault(
      db,
      { ...answer, maxRating: 4, updatedAt: CHANGED },
      P1,
    )

    const mirror = await mirrorRows()
    expect(mirror).toHaveLength(1)
    expect(saved).toMatchObject({
      organizationId: ORG_A,
      category: 'low_ratings',
      channel: 'email',
      enabled: true,
      cadence: 'immediate',
      maxRating: 4,
      updatedAt: CHANGED,
    })
    expect(mirror[0]).toMatchObject({
      organizationId: ORG_A,
      category: 'low_ratings',
      channel: 'email',
      enabled: true,
      cadence: 'immediate',
      maxRating: 4,
      updatedAt: CHANGED,
    })
  })

  it('keeps Organization defaults out of the per-Property rows', async () => {
    await seed()
    const own = await store.findByUser(db, userId(BOTH), organizationId(ORG_A))
    expect(own).toHaveLength(2)
    expect(own.every((row) => row.propertyId !== null)).toBe(true)
    const nullRows = await db
      .select()
      .from(notificationPreferences)
      .where(isNull(notificationPreferences.propertyId))
    expect(nullRows.length).toBeGreaterThanOrEqual(DEFAULTS.length)
  })
})
