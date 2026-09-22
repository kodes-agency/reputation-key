import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notificationPreferences, properties } from '#/shared/db/schema'
import {
  notificationPreferenceId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { updateNotificationPreferenceDto } from '../../application/dto/notification-preference.dto'
import { createNotificationPreference } from '../../domain/constructors-preference'
import type { NotificationPreference } from '../../domain/notification-types'
import { createNotificationPreferenceRepository } from './notification-preference.repository'

const ORG = organizationId('notification-preference-mute-org')
const USER = userId('notification-preference-mute-user')
const PROPERTY = propertyId('84000000-0000-4000-8000-000000000001')
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
    urgentBypassEnabled: false,
    quietHoursStart: '09:00',
    quietHoursEnd: '17:00',
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  }) satisfies NotificationPreference

describe.sequential('notification preference mute repository (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await db.delete(properties).where(eq(properties.id, PROPERTY))
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Preference Test Property',
      slug: 'notification-preference-mute-test',
      timezone: 'UTC',
    })
  })

  afterAll(async () => {
    await db?.delete(properties).where(eq(properties.id, PROPERTY))
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
        quietHoursStart: null,
        quietHoursEnd: null,
        createdAt: MUTED,
        updatedAt: MUTED,
      }),
    )

    expect(muted).toMatchObject({
      id: original.id,
      enabled: false,
      cadence: 'immediate',
      quietHoursStart: '09:00',
      quietHoursEnd: '17:00',
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
      urgentBypassEnabled: false,
      quietHoursStart: null,
      quietHoursEnd: null,
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

  it('reads quiet hours stored with equal times as none, so their row can be saved again', async () => {
    // Stored before equal times were refused. Delivery always read 22:00-22:00
    // as no quiet hours; read back verbatim, it rode along in every whole-row
    // save of this row and got each one refused, Email switch included.
    await db.insert(notificationPreferences).values({
      id: notificationPreferenceId('84000000-0000-4000-8000-000000000007'),
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      category: 'workflow_collaboration',
      channel: 'email',
      enabled: false,
      cadence: 'immediate',
      urgentBypassEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '22:00',
      createdAt: CREATED,
      updatedAt: CREATED,
    })
    const repo = createNotificationPreferenceRepository(db)

    const stored = (await repo.findByUser(USER, ORG)).find(
      (row) => row.category === 'workflow_collaboration' && row.channel === 'email',
    )
    expect(stored).toMatchObject({ quietHoursStart: null, quietHoursEnd: null })

    // The settings page writes back the whole row it read, with Email on.
    const turnEmailOn = { ...stored!, enabled: true, updatedAt: MUTED }
    expect(
      updateNotificationPreferenceDto.safeParse({
        propertyId: PROPERTY,
        category: turnEmailOn.category,
        channel: turnEmailOn.channel,
        enabled: turnEmailOn.enabled,
        cadence: turnEmailOn.cadence,
        urgentBypassEnabled: turnEmailOn.urgentBypassEnabled,
        quietHoursStart: turnEmailOn.quietHoursStart,
        quietHoursEnd: turnEmailOn.quietHoursEnd,
      }).success,
    ).toBe(true)
    const saved = createNotificationPreference(turnEmailOn, () => MUTED)
    expect(saved.isOk()).toBe(true)
    await expect(repo.upsert(saved._unsafeUnwrap())).resolves.toMatchObject({
      enabled: true,
      quietHoursStart: null,
      quietHoursEnd: null,
    })
  })
})
