import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  notificationCategoryDefaults,
  notificationPreferences,
  notificationPropertyDeliveryWindows,
  notificationUserSettings,
  properties,
} from '#/shared/db/schema'
import {
  notificationPreferenceId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type {
  NotificationCategoryDefault,
  NotificationPreference,
} from '../../domain/notification-types'
import { createNotificationPreferenceRepository } from './notification-preference.repository'

const ORG = organizationId('notification-preference-mute-org')
const USER = userId('notification-preference-mute-user')
const PROPERTY = propertyId('84000000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('84000000-0000-4000-8000-00000000000a')
const CREATED = new Date('2026-08-26T08:00:00.000Z')
const MUTED = new Date('2026-08-26T09:00:00.000Z')

const preference = (overrides: Partial<NotificationPreference> = {}) =>
  ({
    id: notificationPreferenceId('84000000-0000-4000-8000-000000000002'),
    userId: USER,
    organizationId: ORG,
    propertyId: PROPERTY,
    category: 'workflow_collaboration' as const,
    channel: 'in_app' as const,
    enabled: true,
    cadence: 'immediate' as const,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  }) satisfies NotificationPreference

const categoryDefault = (
  overrides: Partial<NotificationCategoryDefault> = {},
): NotificationCategoryDefault => ({
  userId: USER,
  organizationId: ORG,
  category: 'workflow_collaboration',
  channel: 'email',
  enabled: true,
  cadence: 'daily',
  createdAt: CREATED,
  updatedAt: CREATED,
  ...overrides,
})

describe.sequential('notification preference repository (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    for (const id of [PROPERTY, OTHER_PROPERTY]) {
      await db.delete(properties).where(eq(properties.id, id))
    }
    await db.insert(properties).values([
      {
        id: PROPERTY,
        organizationId: ORG,
        name: 'Preference Test Property',
        slug: 'notification-preference-mute-test',
        timezone: 'UTC',
      },
      {
        id: OTHER_PROPERTY,
        organizationId: ORG,
        name: 'Second Preference Test Property',
        slug: 'notification-preference-mute-test-2',
        timezone: 'UTC',
      },
    ])
  })

  afterAll(async () => {
    await db
      ?.delete(notificationUserSettings)
      .where(
        and(
          eq(notificationUserSettings.userId, USER),
          eq(notificationUserSettings.organizationId, ORG),
        ),
      )
    for (const id of [PROPERTY, OTHER_PROPERTY]) {
      await db?.delete(properties).where(eq(properties.id, id))
    }
    await lease?.release()
  })

  it('preserves delivery settings when an existing category is muted', async () => {
    const repo = createNotificationPreferenceRepository(db)
    const original = await repo.upsert(preference())
    const muted = await repo.upsertEnabled(
      preference({
        id: notificationPreferenceId('84000000-0000-4000-8000-000000000003'),
        enabled: false,
        cadence: 'daily',
        createdAt: MUTED,
        updatedAt: MUTED,
      }),
    )

    expect(muted).toMatchObject({
      id: original.id,
      enabled: false,
      cadence: 'immediate',
      createdAt: CREATED,
      updatedAt: MUTED,
    })
  })

  it('rejects non-configurable categories and enforces required channels at the database boundary', async () => {
    const base = {
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      enabled: false,
      cadence: 'immediate',
      createdAt: CREATED,
      updatedAt: CREATED,
    }

    await expect(
      db.insert(notificationPreferences).values({
        ...base,
        id: notificationPreferenceId('84000000-0000-4000-8000-000000000004'),
        category: 'mandatory',
        channel: 'email',
      }),
    ).rejects.toMatchObject({
      cause: {
        constraint: 'notification_preferences_configurable_category_check',
      },
    })

    await expect(
      db.insert(notificationPreferences).values({
        ...base,
        id: notificationPreferenceId('84000000-0000-4000-8000-000000000005'),
        category: 'urgent_operational',
        channel: 'in_app',
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'notification_preferences_required_enabled' },
    })

    await expect(
      db.insert(notificationPreferences).values({
        ...base,
        id: notificationPreferenceId('84000000-0000-4000-8000-000000000006'),
        category: 'urgent_operational',
        channel: 'email',
      }),
    ).resolves.toBeDefined()
  })
})

// ADR 0046, amended 2026-09-23 — quiet hours, the urgent bypass and the
// per-category default a new Property inherits.
describe.sequential('personal notification delivery (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const clean = async () => {
    await db
      .delete(notificationPropertyDeliveryWindows)
      .where(eq(notificationPropertyDeliveryWindows.userId, USER))
    await db
      .delete(notificationCategoryDefaults)
      .where(eq(notificationCategoryDefaults.userId, USER))
    await db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.userId, USER))
    await db
      .delete(notificationUserSettings)
      .where(eq(notificationUserSettings.userId, USER))
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    for (const id of [PROPERTY, OTHER_PROPERTY]) {
      await db.delete(properties).where(eq(properties.id, id))
    }
    await db.insert(properties).values([
      {
        id: PROPERTY,
        organizationId: ORG,
        name: 'Personal Window Property',
        slug: 'notification-personal-window-test',
        timezone: 'UTC',
      },
      {
        id: OTHER_PROPERTY,
        organizationId: ORG,
        name: 'Personal Window Property Two',
        slug: 'notification-personal-window-test-2',
        timezone: 'UTC',
      },
    ])
  })

  beforeEach(clean)

  afterAll(async () => {
    await clean()
    for (const id of [PROPERTY, OTHER_PROPERTY]) {
      await db?.delete(properties).where(eq(properties.id, id))
    }
    await lease?.release()
  })

  const savePersonalWindow = async (
    start: string | null,
    end: string | null,
    urgentBypassEnabled = false,
  ) => {
    const repo = createNotificationPreferenceRepository(db)
    await repo.upsertUserSettings({
      userId: USER,
      organizationId: ORG,
      locale: 'en',
      timezone: 'Europe/Sofia',
      quietHoursStart: start,
      quietHoursEnd: end,
      urgentBypassEnabled,
      createdAt: CREATED,
      updatedAt: CREATED,
    })
    return repo
  }

  it("gives every property the person's own window when none overrides it", async () => {
    const repo = await savePersonalWindow('22:00', '07:00', true)

    await expect(repo.resolveDeliveryWindow(USER, ORG, PROPERTY)).resolves.toEqual({
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      urgentBypassEnabled: true,
    })
    await expect(repo.resolveDeliveryWindow(USER, ORG, OTHER_PROPERTY)).resolves.toEqual({
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      urgentBypassEnabled: true,
    })
  })

  it("replaces the person's window whole at a property that overrides it", async () => {
    const repo = await savePersonalWindow('22:00', '07:00', true)
    await repo.upsertPropertyDeliveryWindow({
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      quietHoursStart: null,
      quietHoursEnd: null,
      urgentBypassEnabled: false,
      createdAt: CREATED,
      updatedAt: CREATED,
    })

    // The override says "hold nothing back here", and it takes the bypass with
    // it: an override is one deliberate answer, not a patch of three fields.
    await expect(repo.resolveDeliveryWindow(USER, ORG, PROPERTY)).resolves.toEqual({
      quietHoursStart: null,
      quietHoursEnd: null,
      urgentBypassEnabled: false,
    })
    // The digest passes no property, so no override can reach it.
    await expect(repo.resolveDeliveryWindow(USER, ORG, null)).resolves.toEqual({
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      urgentBypassEnabled: true,
    })
  })

  it('follows the person again once the override is removed', async () => {
    const repo = await savePersonalWindow('22:00', '07:00')
    await repo.upsertPropertyDeliveryWindow({
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      quietHoursStart: '01:00',
      quietHoursEnd: '02:00',
      urgentBypassEnabled: false,
      createdAt: CREATED,
      updatedAt: CREATED,
    })

    await repo.clearPropertyDeliveryWindow(USER, ORG, PROPERTY)

    await expect(repo.resolveDeliveryWindow(USER, ORG, PROPERTY)).resolves.toMatchObject({
      quietHoursStart: '22:00',
    })
    await expect(repo.findPropertyDeliveryWindows(USER, ORG)).resolves.toEqual([])
  })

  it('refuses a stored window that starts and ends at the same time', async () => {
    await expect(
      db.insert(notificationUserSettings).values({
        userId: USER,
        organizationId: ORG,
        quietHoursStart: '22:00',
        quietHoursEnd: '22:00',
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'notification_user_settings_quiet_distinct' },
    })

    await expect(
      db.insert(notificationPropertyDeliveryWindows).values({
        userId: USER,
        organizationId: ORG,
        propertyId: PROPERTY,
        quietHoursStart: '22:00',
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'notification_property_delivery_windows_quiet_pair' },
    })
  })

  it("gives a property with no row of its own the person's category default", async () => {
    const repo = createNotificationPreferenceRepository(db)
    await repo.applyCategoryDefaultEverywhere(categoryDefault({ enabled: true }))

    // A Property added or reassigned since falls to the default, not to ADR
    // 0046's versioned "email off" — the reason a brand-new Property used to
    // behave like a Property nobody had configured.
    await expect(
      repo.resolveForDelivery(
        USER,
        ORG,
        OTHER_PROPERTY,
        'workflow_collaboration',
        'email',
      ),
    ).resolves.toEqual({ enabled: true, cadence: 'daily' })
  })

  it("lets one property's own row override the person's default", async () => {
    const repo = createNotificationPreferenceRepository(db)
    await repo.applyCategoryDefaultEverywhere(categoryDefault({ enabled: true }))
    await repo.upsert(
      preference({
        id: notificationPreferenceId('84000000-0000-4000-8000-00000000000b'),
        channel: 'email',
        enabled: false,
        cadence: 'daily',
      }),
    )

    await expect(
      repo.resolveForDelivery(USER, ORG, PROPERTY, 'workflow_collaboration', 'email'),
    ).resolves.toEqual({ enabled: false, cadence: 'daily' })
    await expect(
      repo.resolveForDelivery(
        USER,
        ORG,
        OTHER_PROPERTY,
        'workflow_collaboration',
        'email',
      ),
    ).resolves.toEqual({ enabled: true, cadence: 'daily' })
  })

  it('clears the rows that would have overridden an "apply to all" answer', async () => {
    const repo = createNotificationPreferenceRepository(db)
    await repo.upsert(
      preference({
        id: notificationPreferenceId('84000000-0000-4000-8000-00000000000c'),
        channel: 'email',
        enabled: false,
        cadence: 'daily',
      }),
    )

    await repo.applyCategoryDefaultEverywhere(categoryDefault({ enabled: true }))

    await expect(repo.findByUser(USER, ORG)).resolves.toEqual([])
    await expect(
      repo.resolveForDelivery(USER, ORG, PROPERTY, 'workflow_collaboration', 'email'),
    ).resolves.toEqual({ enabled: true, cadence: 'daily' })
  })

  it('refuses a default for a channel its category requires', async () => {
    await expect(
      db.insert(notificationCategoryDefaults).values({
        userId: USER,
        organizationId: ORG,
        category: 'urgent_operational',
        channel: 'in_app',
        enabled: false,
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'notification_category_defaults_required_enabled' },
    })

    await expect(
      db.insert(notificationCategoryDefaults).values({
        userId: USER,
        organizationId: ORG,
        category: 'mandatory',
        channel: 'email',
        enabled: true,
      }),
    ).rejects.toMatchObject({
      cause: {
        constraint: 'notification_category_defaults_configurable_category_check',
      },
    })
  })
})
