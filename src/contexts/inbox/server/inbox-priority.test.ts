// Inbox context — the manager priority server function (ADR 0071).
// Imports and invokes the actual createServerFn handler, like the sibling
// server-function suites: the wrapper resolves to undefined outside the server
// runtime and `.validator()` does not run, so the assertions are on the gate,
// the arguments forwarded to the use case, and how its refusals come back.

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setInboxItemPriority: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    inboxPublicApi: { setInboxItemPriority: mocks.setInboxItemPriority },
  })),
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
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import { inboxError, PRIORITY_CHANGED_MESSAGE } from '../domain/errors'
import { setInboxItemPriorityFn } from './inbox-priority'

const ITEM_ID = '7b000000-0000-4000-8000-000000000002'

const ACTOR = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  userId: 'user-manager-1',
  role: 'PropertyManager',
} as const

const INPUT = {
  inboxItemId: ITEM_ID,
  expectedCommandRevision: 4,
  expectedPriority: null,
  priority: 'urgent',
} as const

const send = () => withStartContext(() => setInboxItemPriorityFn({ data: INPUT }))

describe('setInboxItemPriorityFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('gates on inbox.write and forwards the fenced choice to the use case', async () => {
    mocks.setInboxItemPriority.mockResolvedValue({ id: ITEM_ID, commandRevision: 5 })

    await send()

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'inbox.write',
    })
    expect(mocks.setInboxItemPriority).toHaveBeenCalledWith(
      {
        inboxItemId: ITEM_ID,
        expectedCommandRevision: 4,
        expectedPriority: null,
        priority: 'urgent',
      },
      ACTOR,
    )
  })

  it('writes nothing when the inbox.write execution control is off', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('execution denied'))

    await expect(send()).rejects.toThrow('execution denied')
    expect(mocks.setInboxItemPriority).not.toHaveBeenCalled()
  })

  // The conflict comes back as a RESULT, never a throw: that is what the
  // client's one revision retry reads (`inbox-priority-refusal.test.ts`). Out
  // here the wrapper's value is undefined, so what is observable is that the
  // call settles instead of rejecting.
  it('answers a stale revision without throwing, for the client to retry', async () => {
    mocks.setInboxItemPriority.mockRejectedValue(
      inboxError('revision_conflict', 'Inbox item changed; reload current state', {
        currentCommandRevision: 6,
        currentStatus: 'open',
      }),
    )

    await expect(send()).resolves.toBeUndefined()
  })

  it('throws a change to the priority itself as a 409 the retry never replays', async () => {
    mocks.setInboxItemPriority.mockRejectedValue(
      inboxError('priority_changed', PRIORITY_CHANGED_MESSAGE, {
        inboxItemId: ITEM_ID,
        currentCommandRevision: 6,
      }),
    )

    await expect(send()).rejects.toMatchObject({
      _tag: 'InboxError',
      code: 'priority_changed',
      status: 409,
      message: PRIORITY_CHANGED_MESSAGE,
    })
  })
})
