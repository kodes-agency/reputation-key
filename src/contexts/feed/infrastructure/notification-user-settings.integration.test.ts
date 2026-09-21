import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notificationUserSettings, properties } from '#/shared/db/schema'
import { organizationId, recentActivityEntryId, userId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { OutboxRepository } from '#/shared/outbox'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { operationalActionHistoryRecordId } from '../domain/operational-action-history'
import { buildFeedContext } from '../build'

const ORG = organizationId('notification-effective-settings-org')
const USER = userId('notification-effective-settings-user')
const NOW = new Date('2026-09-21T20:30:00.000Z')

/** The Feed build exactly as composition wires it, on a real database. */
const buildFeed = (db: Database) => {
  const logger = createMockLogger()
  return buildFeedContext({
    activity: {
      db,
      staffPublicApi: {} as StaffPublicApi,
      clock: () => NOW,
      logger,
      idGen: () => recentActivityEntryId('86000000-0000-4000-8000-000000000099'),
      operationalHistoryIdGen: () =>
        operationalActionHistoryRecordId('86000000-0000-4000-8000-000000000098'),
      operationalHistoryHoldIdGen: () => '86000000-0000-4000-8000-000000000097',
    },
    notification: {
      db,
      outboxRepo: {} as OutboxRepository,
      queue: undefined,
      clock: () => NOW,
      idGen: () => '86000000-0000-4000-8000-000000000096',
      logger,
      responsibleManagers: {} as never,
      feedbackPortalLookup: {} as never,
      googleConnectionProperties: {} as never,
      monthlyResultFacts: {} as never,
      portalHealthLookup: {} as never,
    },
  })
}

describe.sequential(
  'effective notification settings through the Feed build (real PostgreSQL)',
  () => {
    let lease: TestLease
    let db: Database

    const clearScope = async () => {
      await db
        .delete(notificationUserSettings)
        .where(eq(notificationUserSettings.organizationId, ORG))
      await db.delete(properties).where(eq(properties.organizationId, ORG))
    }

    beforeAll(async () => {
      lease = await acquireTestLease(getEnv().DATABASE_URL)
      db = drizzle(lease.pool) as Database
      await clearScope()
      await db.insert(properties).values(
        [
          ['86000000-0000-4000-8000-000000000001', 'Europe/Sofia'],
          ['86000000-0000-4000-8000-000000000002', 'Europe/Sofia'],
          ['86000000-0000-4000-8000-000000000003', 'America/Denver'],
        ].map(([id, timezone], index) => ({
          id: id!,
          organizationId: ORG,
          name: `Effective Settings Property ${index + 1}`,
          slug: `notification-effective-settings-${index + 1}`,
          timezone: timezone!,
        })),
      )
    })

    afterAll(async () => {
      if (db) await clearScope()
      await lease?.release()
    })

    it("gives a user who never saved settings their Organization's timezone", async () => {
      const feed = buildFeed(db)

      await expect(feed.publicApi.getUserSettings(USER, ORG)).resolves.toEqual({
        locale: 'en',
        timezone: 'Europe/Sofia',
        timezoneSource: 'organization',
      })
    })

    it('keeps that timezone when the first save changes only the language', async () => {
      const feed = buildFeed(db)

      await feed.publicApi.updateUserSettings(USER, ORG, { locale: 'en-GB' })

      const rows = await db
        .select()
        .from(notificationUserSettings)
        .where(
          and(
            eq(notificationUserSettings.organizationId, ORG),
            eq(notificationUserSettings.userId, USER),
          ),
        )
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ locale: 'en-GB', timezone: 'Europe/Sofia' })
    })
  },
)
