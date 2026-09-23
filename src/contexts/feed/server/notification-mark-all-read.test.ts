// "Mark all read" carries the filter tab the reader is on to Feed.
//
// It used to take no input at all, so the Workflow tab's "Mark all read"
// cleared urgent Action-needed and account notices too. The real
// createServerFn handler and tracedHandler run here; only the session and the
// composed Feed public API are stubbed.

import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  markAllRead: vi.fn(async () => undefined),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({ feedPublicApi: { markAllRead: mocks.markAllRead } })),
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

import { markAllNotificationsReadDto } from '../application/dto/notification-mark-all-read.dto'
import { markAllNotificationsReadFn } from './notifications'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const ACTOR = {
  organizationId: 'org-notification-mark-all-read',
  userId: 'user-notification-mark-all-read',
  role: 'PropertyManager',
} as const

describe('markAllNotificationsReadFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('marks read only what the reader’s filter tab holds', async () => {
    await withStartContext(() =>
      markAllNotificationsReadFn({ data: { filter: 'workflow_collaboration' } }),
    )

    expect(mocks.markAllRead).toHaveBeenCalledWith(
      ACTOR.userId,
      ACTOR.organizationId,
      'workflow_collaboration',
    )
  })

  it('keeps marking everything for a tab still running the bundle that sent no filter', async () => {
    await withStartContext(() => markAllNotificationsReadFn({ data: undefined }))

    expect(mocks.markAllRead).toHaveBeenCalledWith(
      ACTOR.userId,
      ACTOR.organizationId,
      'all',
    )
  })

  it('refuses a filter the feed does not have', () => {
    expect(markAllNotificationsReadDto.safeParse({ filter: 'everything' }).success).toBe(
      false,
    )
  })
})
