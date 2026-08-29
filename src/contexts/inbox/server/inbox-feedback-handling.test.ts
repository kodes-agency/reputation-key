// Inbox context — private-feedback handling server function tests.
// Imports and invokes the actual createServerFn handlers (not just the DTOs),
// so the boundary contract is executable: execution gate → fence regrouping →
// use case → domain error → HTTP status.
//
// Two properties of invoking a server fn outside the server runtime shape what
// can be asserted here: the wrapper resolves to undefined (the handler's return
// value is not observable), and `.validator()` does not run. Assertions are
// therefore on the arguments forwarded to the use case and on the errors that
// do propagate; DTO parsing is covered directly in inbox-server.test.ts.

import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  markFeedbackHandled: vi.fn(),
  correctFeedbackHandlingOutcome: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    inboxPublicApi: {
      markFeedbackHandled: mocks.markFeedbackHandled,
      correctFeedbackHandlingOutcome: mocks.correctFeedbackHandlingOutcome,
    },
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

import { inboxError } from '../domain/errors'
import {
  correctFeedbackHandlingOutcomeFn,
  markFeedbackHandledFn,
} from './inbox-feedback-handling'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const INBOX_ITEM_ID = '550e8400-e29b-41d4-a716-446655440000'
const OUTCOME_ID = '650e8400-e29b-41d4-a716-446655440000'

const ACTOR = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  userId: 'user-manager-1',
  role: 'PropertyManager',
} as const

// The wire shape: four flat revision fences the handler must regroup.
const command = {
  inboxItemId: INBOX_ITEM_ID,
  outcome: 'follow_up_completed' as const,
  expectedCommandRevision: 2,
  expectedCycleNumber: 1,
  expectedSourceRevision: 4,
  expectedStateRevision: 3,
}
const correction = {
  ...command,
  expectedOutcomeId: OUTCOME_ID,
  expectedOutcomeRevision: 1,
}

const commandProbes: readonly [name: string, invoke: () => Promise<unknown>][] = [
  ['mark handled', () => markFeedbackHandledFn({ data: command })],
  ['outcome correction', () => correctFeedbackHandlingOutcomeFn({ data: correction })],
]

describe('private-feedback handling server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('gates on inbox.write and regroups the flat fences under one expectation', async () => {
    mocks.markFeedbackHandled.mockResolvedValue({ outcomeId: OUTCOME_ID })

    await withStartContext(() => markFeedbackHandledFn({ data: command }))
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'inbox.write',
    })
    expect(mocks.markFeedbackHandled).toHaveBeenCalledWith(
      {
        inboxItemId: INBOX_ITEM_ID,
        expected: {
          commandRevision: 2,
          cycleNumber: 1,
          sourceRevision: 4,
          stateRevision: 3,
        },
        outcome: 'follow_up_completed',
        // An omitted note is an explicit "no note", never undefined.
        internalNote: null,
      },
      ACTOR,
    )
  })

  it('carries an internal note through as an internal-only fact', async () => {
    mocks.markFeedbackHandled.mockResolvedValue({})

    await withStartContext(() =>
      markFeedbackHandledFn({
        data: { ...command, internalNote: 'Guest confirmed the issue was resolved.' },
      }),
    )
    expect(mocks.markFeedbackHandled.mock.calls[0]![0]).toMatchObject({
      internalNote: 'Guest confirmed the issue was resolved.',
    })
  })

  it('fences a correction on the exact outcome fact it supersedes', async () => {
    mocks.correctFeedbackHandlingOutcome.mockResolvedValue({ outcomeRevision: 2 })

    await withStartContext(() =>
      correctFeedbackHandlingOutcomeFn({
        data: { ...correction, outcome: 'follow_up_attempted' },
      }),
    )
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'inbox.write',
    })
    expect(mocks.correctFeedbackHandlingOutcome).toHaveBeenCalledWith(
      {
        inboxItemId: INBOX_ITEM_ID,
        expected: {
          commandRevision: 2,
          cycleNumber: 1,
          sourceRevision: 4,
          stateRevision: 3,
          outcomeId: OUTCOME_ID,
          outcomeRevision: 1,
        },
        outcome: 'follow_up_attempted',
        internalNote: null,
      },
      ACTOR,
    )
  })

  it('surfaces a stale fence as a 409 InboxError rather than a generic failure', async () => {
    mocks.markFeedbackHandled.mockRejectedValue(
      inboxError('revision_conflict', 'This item changed while you were working on it'),
    )

    await expect(
      withStartContext(() => markFeedbackHandledFn({ data: command })),
    ).rejects.toMatchObject({
      _tag: 'InboxError',
      code: 'revision_conflict',
      status: 409,
    })
  })

  it('masks an untagged store failure and keeps its detail off the wire', async () => {
    const privateDetail =
      'duplicate key value violates unique constraint "feedback_handling_outcome_pkey"'
    mocks.correctFeedbackHandlingOutcome.mockRejectedValue(new Error(privateDetail))

    const thrown = await withStartContext(() =>
      correctFeedbackHandlingOutcomeFn({ data: correction }).then(
        () => null,
        (error: unknown) => error,
      ),
    )
    expect(thrown).toMatchObject({
      _tag: 'InternalError',
      code: 'internal_error',
      status: 500,
    })
    expect((thrown as Error).message).not.toContain(privateDetail)
  })

  it.each(commandProbes)(
    'stops %s before any effect when execution is denied',
    async (_name, invoke) => {
      mocks.requireExecutionAllowed.mockRejectedValue(new Error('execution denied'))

      await expect(withStartContext(invoke)).rejects.toThrow('execution denied')
      expect(mocks.markFeedbackHandled).not.toHaveBeenCalled()
      expect(mocks.correctFeedbackHandlingOutcome).not.toHaveBeenCalled()
    },
  )
})
