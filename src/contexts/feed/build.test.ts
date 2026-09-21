import { describe, expect, it } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { OutboxRepository } from '#/shared/outbox'
import { recentActivityEntryId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { operationalActionHistoryRecordId } from './domain/operational-action-history'
import { buildFeedContext } from './build'
import { NOTIFICATION_HEALTH_READ_STATEMENT_TIMEOUT_MS } from './infrastructure/repositories/health-read-timeout'

function buildWith(db: Database) {
  const logger = createMockLogger()
  return buildFeedContext({
    activity: {
      db,
      staffPublicApi: {} as StaffPublicApi,
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      logger,
      idGen: () => recentActivityEntryId('00000000-0000-4000-8000-000000000999'),
      operationalHistoryIdGen: () =>
        operationalActionHistoryRecordId('00000000-0000-4000-8000-000000000998'),
      operationalHistoryHoldIdGen: () => '00000000-0000-4000-8000-000000000997',
    },
    notification: {
      db,
      outboxRepo: {} as OutboxRepository,
      queue: undefined,
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      idGen: () => '00000000-0000-4000-8000-000000000996',
      logger,
      responsibleManagers: {} as never,
      feedbackPortalLookup: {} as never,
      googleConnectionProperties: {} as never,
      monthlyResultFacts: {} as never,
      portalHealthLookup: {} as never,
      isEmailDeliveryAllowed: () => false,
      propertyAccess: async () => null,
    },
  })
}

describe('buildFeedContext', () => {
  it('merges the activity and notification public APIs behind one build', () => {
    const context = buildWith({} as Database)

    expect(Object.keys(context).sort()).toEqual(['activity', 'notification', 'publicApi'])
    expect(context.publicApi.getActivityTimeline).toBe(
      context.activity.publicApi.getActivityTimeline,
    )
    expect(context.publicApi.getFeedHead).toBe(context.notification.publicApi.getFeedHead)

    const activity = context.activity
    expect(activity.organizationExportContributor.context).toBe('activity')
    expect(activity.publicApi).not.toHaveProperty('organizationExportContributor')
    expect(activity.organizationLifecycleContributor.context).toBe('activity')
    expect(activity.organizationLifecycleContributor.prepareClosing).toBeTypeOf(
      'function',
    )
    expect(activity.organizationLifecycleContributor.verifyPurgeReadiness).toBeTypeOf(
      'function',
    )
    expect(activity.organizationLifecycleContributor.purge).toBeTypeOf('function')
    expect(activity.publicApi).not.toHaveProperty('organizationLifecycleContributor')
    expect(Object.keys(activity.worker).sort()).toEqual([
      'projectRecentActivity',
      'registerOutboxConsumers',
    ])
    expect(activity.worker.registerOutboxConsumers).toBeTypeOf('function')
    expect(Object.keys(activity.internal).sort()).toEqual(['repos', 'useCases'])
    expect(activity.internal.useCases).toMatchObject({
      getActivityTimeline: context.publicApi.getActivityTimeline,
      listRecentActivity: context.publicApi.listRecentActivity,
      listOperationalActionHistory: context.publicApi.listOperationalActionHistory,
      exportOperationalActionHistory: context.publicApi.exportOperationalActionHistory,
    })
    expect(activity.internal.useCases.recoverRecentActivity).toBeTypeOf('function')
    expect(activity.internal.useCases.getRecentActivityReadiness).toBeTypeOf('function')
    expect(activity.internal.useCases.appendOperationalAction).toBeTypeOf('function')
    expect(activity.internal.useCases.getOperationalActionHistoryReadiness).toBeTypeOf(
      'function',
    )
    expect(activity.internal.useCases.assessOperationalActionHistoryRetention).toBeTypeOf(
      'function',
    )
    expect(activity.internal.useCases.placeOperationalActionHistoryLegalHold).toBeTypeOf(
      'function',
    )
    expect(
      activity.internal.useCases.releaseOperationalActionHistoryLegalHold,
    ).toBeTypeOf('function')
    expect(activity.internal.useCases.redactOperationalActionHistorySubject).toBeTypeOf(
      'function',
    )
  })

  // The operations snapshot stops waiting for a health signal at its own cap;
  // the database must stop working for it too.
  it('reads the notification health gauges under the health statement timeout', async () => {
    const statements: SQL[] = []
    const configs: unknown[] = []
    const db = {
      execute: async (query: SQL) => {
        statements.push(query)
        return { rows: [] }
      },
      transaction: async (
        run: (transaction: unknown) => Promise<unknown>,
        config: unknown,
      ) => {
        configs.push(config)
        return run(db)
      },
    }
    const { publicApi } = buildWith(db as unknown as Database).notification

    await publicApi.readMissingNotificationCount()
    await publicApi.readNotificationDeliveryLag()

    const timeouts = statements
      .map((query) => new PgDialect().sqlToQuery(query))
      .filter(({ sql }) => sql.includes("set_config('statement_timeout'"))
    expect(timeouts.map(({ params }) => params)).toEqual([
      [String(NOTIFICATION_HEALTH_READ_STATEMENT_TIMEOUT_MS)],
      [String(NOTIFICATION_HEALTH_READ_STATEMENT_TIMEOUT_MS)],
    ])
    expect(configs).toEqual([{ accessMode: 'read only' }, { accessMode: 'read only' }])
  })
})
