import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema'
import {
  notificationPreferenceId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { NotificationPreference } from '../../domain/types'
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
})
