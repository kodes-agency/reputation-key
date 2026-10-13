// Operational Action History server functions map Feed's refusals to HTTP
// statuses.
//
// Invokes the real createServerFn handlers, the real tracedHandler safety net
// and the real access use cases, so the whole boundary is executable. The
// refusal is the one a demoted AccountAdmin meets: the session still resolves
// the role, so the execution policy passes, and the use case's own fresh
// authority read says no. An untagged 500 there reads as an outage and logs a
// stack for what is an ordinary denial.

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  feedPublicApi: undefined as unknown,
}))

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({ feedPublicApi: mocks.feedPublicApi })),
}))
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn() }))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))

import {
  exportOperationalActionHistory,
  listOperationalActionHistory,
  type OperationalActionHistoryAccessDeps,
} from '../application/use-cases/operational-action-history-access'
import {
  operationalActionHistoryRecordId,
  type OperationalActionRecord,
} from '../domain/operational-action-history'
import {
  exportOperationalActionHistoryFn,
  listOperationalActionHistoryFn,
} from './activity'

const ACTOR = {
  organizationId: 'org-history-errors',
  userId: 'user-history-errors',
  role: 'AccountAdmin',
} as const

type Authority = OperationalActionHistoryAccessDeps['accessAuthority']

const demoted: Authority = { isCurrentAccountAdmin: async () => false }
const authorityDown: Authority = {
  isCurrentAccountAdmin: async () => {
    throw new Error('identity is unreachable')
  },
}

function buildHistoryApi(accessAuthority: Authority) {
  const appended: OperationalActionRecord[] = []
  const deps = {
    accessAuthority,
    store: {
      append: async (record: OperationalActionRecord) => {
        appended.push(record)
      },
    } as unknown as OperationalActionHistoryAccessDeps['store'],
    clock: () => new Date('2026-10-13T09:00:00.000Z'),
    idGen: () => operationalActionHistoryRecordId('91000000-0000-4000-8000-000000000001'),
  } satisfies OperationalActionHistoryAccessDeps
  mocks.feedPublicApi = {
    listOperationalActionHistory: listOperationalActionHistory(deps),
    exportOperationalActionHistory: exportOperationalActionHistory(deps),
  }
  return appended
}

const historyReads = [
  ['listOperationalActionHistoryFn', listOperationalActionHistoryFn],
  ['exportOperationalActionHistoryFn', exportOperationalActionHistoryFn],
] as const

describe('Operational Action History server functions map Feed refusals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it.each(historyReads)(
    '%s answers a caller who is no longer an AccountAdmin with 403, not an untagged 500',
    async (_name, serverFn) => {
      const appended = buildHistoryApi(demoted)

      await expect(
        withStartContext<unknown>(() => serverFn({ data: {} })),
      ).rejects.toMatchObject({
        _tag: 'ActivityError',
        code: 'operational_history_access_denied',
        status: 403,
      })
      expect(
        appended.map(({ outcome, reasonCode }) => ({ outcome, reasonCode })),
      ).toEqual([{ outcome: 'denied', reasonCode: 'not_current_account_admin' }])
    },
  )

  it.each(historyReads)(
    '%s answers an unreachable access authority with 503, not an untagged 500',
    async (_name, serverFn) => {
      buildHistoryApi(authorityDown)

      await expect(
        withStartContext<unknown>(() => serverFn({ data: {} })),
      ).rejects.toMatchObject({
        _tag: 'ActivityError',
        code: 'operational_history_unavailable',
        status: 503,
      })
    },
  )

  it('still masks a failure that is not a Feed refusal', async () => {
    mocks.feedPublicApi = {
      listOperationalActionHistory: async () => {
        throw new Error('relation "operational_action_history" does not exist')
      },
    }

    await expect(
      withStartContext<unknown>(() => listOperationalActionHistoryFn({ data: {} })),
    ).rejects.toMatchObject({
      code: 'internal_error',
      status: 500,
      message: 'Internal server error',
    })
  })
})
