// Notification server functions map Feed's domain refusals to HTTP statuses.
//
// Invokes the real createServerFn handlers, the real tracedHandler safety net
// and the real Feed public API, so the whole boundary is executable: an async
// public-API rejection must reach the handler's own catch, or it falls through
// to tracedHandler and is masked as an untagged 500.
//
// The database is a stub with no notification rows. That is exactly what a
// retention-swept or foreign id sees: the ownership guard finds nothing and
// refuses with `not_found` before any write.

import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { OutboxRepository } from '#/shared/outbox'
import { recentActivityEntryId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  feedPublicApi: undefined as unknown,
}))

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({ feedPublicApi: mocks.feedPublicApi })),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))

import { operationalActionHistoryRecordId } from '../domain/operational-action-history'
import { buildFeedContext } from '../build'
import {
  dismissNotificationFn,
  markNotificationReadFn,
  markNotificationUnreadFn,
  muteNotificationCategoryFn,
} from './notifications'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const ACTOR = {
  organizationId: 'org-notification-errors',
  userId: 'user-notification-errors',
  role: 'PropertyManager',
} as const
const STALE_NOTIFICATION_ID = '90000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '90000000-0000-4000-8000-000000000002'

const noNotificationRows = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
} as unknown as Database

function buildFeedPublicApi() {
  const clock = () => new Date('2026-09-22T09:00:00.000Z')
  const logger = createMockLogger()
  return buildFeedContext({
    activity: {
      db: noNotificationRows,
      staffPublicApi: {} as StaffPublicApi,
      clock,
      logger,
      idGen: () => recentActivityEntryId('90000000-0000-4000-8000-000000000999'),
      operationalHistoryIdGen: () =>
        operationalActionHistoryRecordId('90000000-0000-4000-8000-000000000998'),
      operationalHistoryHoldIdGen: () => '90000000-0000-4000-8000-000000000997',
    },
    notification: {
      db: noNotificationRows,
      outboxRepo: {} as OutboxRepository,
      queue: undefined,
      clock,
      idGen: () => '90000000-0000-4000-8000-000000000996',
      logger,
      responsibleManagers: {} as never,
      feedbackPortalLookup: {} as never,
      googleConnectionProperties: {} as never,
      monthlyResultFacts: {} as never,
      portalHealthLookup: {} as never,
      propertyAccess: async () => null,
    },
  }).publicApi
}

const ownedRowMutations = [
  ['markNotificationReadFn', markNotificationReadFn],
  ['markNotificationUnreadFn', markNotificationUnreadFn],
  ['dismissNotificationFn', dismissNotificationFn],
] as const

describe('notification server functions map Feed refusals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.feedPublicApi = buildFeedPublicApi()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it.each(ownedRowMutations)(
    '%s answers a stale or foreign id with 404, not an untagged 500',
    async (_name, serverFn) => {
      await expect(
        withStartContext<unknown>(() =>
          serverFn({ data: { notificationId: STALE_NOTIFICATION_ID } }),
        ),
      ).rejects.toMatchObject({
        _tag: 'NotificationError',
        code: 'not_found',
        status: 404,
      })
    },
  )

  it('refuses to mute a required in-app channel with 400 and the domain reason', async () => {
    await expect(
      withStartContext(() =>
        muteNotificationCategoryFn({
          data: { propertyId: PROPERTY_ID, category: 'urgent_operational' },
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'NotificationError',
      code: 'invalid_input',
      status: 400,
      message: 'This notification channel is required and cannot be disabled',
    })
  })
})
