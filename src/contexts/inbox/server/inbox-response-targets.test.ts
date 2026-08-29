// Inbox context — response-target policy/analytics server function tests.
// Imports and invokes the actual createServerFn handlers so the boundary
// contract is executable: execution gate → scope shaping → use case →
// domain error → HTTP status.
//
// Two properties of invoking a server fn outside the server runtime shape what
// can be asserted here: the wrapper resolves to undefined (the handler's return
// value is not observable), and `.validator()` does not run. Assertions are
// therefore on the arguments forwarded to the use case and on the errors that
// do propagate; DTO parsing is covered directly in inbox-server.test.ts.

import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getResponseTargetPolicySettings: vi.fn(),
  getPrivateFeedbackTargetAnalytics: vi.fn(),
  getGoogleReviewTargetAnalytics: vi.fn(),
  setResponseTargetPolicy: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    inboxPublicApi: {
      getResponseTargetPolicySettings: mocks.getResponseTargetPolicySettings,
      getPrivateFeedbackTargetAnalytics: mocks.getPrivateFeedbackTargetAnalytics,
      getGoogleReviewTargetAnalytics: mocks.getGoogleReviewTargetAnalytics,
      setResponseTargetPolicy: mocks.setResponseTargetPolicy,
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
  getGoogleReviewTargetAnalyticsFn,
  getPrivateFeedbackTargetAnalyticsFn,
  getResponseTargetPolicySettingsFn,
  setResponseTargetPolicyFn,
} from './inbox-response-targets'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const PROPERTY_ID = '750e8400-e29b-41d4-a716-446655440000'

const ACTOR = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  userId: 'user-admin-1',
  role: 'AccountAdmin',
} as const

const organizationPolicy = {
  scope: 'organization' as const,
  targetKind: 'private_feedback_handling' as const,
  durationMinutes: 1_440,
  expectedPolicyVersion: 3,
}

const analyticsReads: readonly [name: string, invoke: () => Promise<unknown>][] = [
  ['private feedback', () => getPrivateFeedbackTargetAnalyticsFn({ data: {} })],
  ['Google reviews', () => getGoogleReviewTargetAnalyticsFn({ data: {} })],
]

const deniedProbes: readonly [
  name: string,
  invoke: () => Promise<unknown>,
  effect: ReturnType<typeof vi.fn>,
][] = [
  [
    'the policy read',
    () => getResponseTargetPolicySettingsFn({ data: {} }),
    mocks.getResponseTargetPolicySettings,
  ],
  [
    'the private-feedback analytics read',
    () => getPrivateFeedbackTargetAnalyticsFn({ data: {} }),
    mocks.getPrivateFeedbackTargetAnalytics,
  ],
  [
    'the Google review analytics read',
    () => getGoogleReviewTargetAnalyticsFn({ data: {} }),
    mocks.getGoogleReviewTargetAnalytics,
  ],
  [
    'the policy write',
    () => setResponseTargetPolicyFn({ data: organizationPolicy }),
    mocks.setResponseTargetPolicy,
  ],
]

describe('response-target server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('reads the policy org-wide when no property is named', async () => {
    mocks.getResponseTargetPolicySettings.mockResolvedValue({ organization: null })

    await withStartContext(() => getResponseTargetPolicySettingsFn({ data: {} }))
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'organization.update',
    })
    // An absent property means "whole organization", not "property undefined".
    // toHaveBeenCalledWith uses toEqual semantics, which treat a missing key and
    // an explicitly-undefined one as identical, so the key absence is pinned
    // separately on the first argument.
    expect(mocks.getResponseTargetPolicySettings).toHaveBeenCalledWith({}, ACTOR)
    const [scope] = mocks.getResponseTargetPolicySettings.mock.calls[0]!
    expect(scope).not.toHaveProperty('propertyId')
  })

  it('narrows the policy read to the named property', async () => {
    mocks.getResponseTargetPolicySettings.mockResolvedValue({ organization: null })

    await withStartContext(() =>
      getResponseTargetPolicySettingsFn({ data: { propertyId: PROPERTY_ID } }),
    )
    expect(mocks.getResponseTargetPolicySettings).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID },
      ACTOR,
    )
  })

  it('keeps the two analytics reads on their own use cases', async () => {
    // Both endpoints share one validator, so a cross-wired container lookup
    // would otherwise be invisible.
    mocks.getPrivateFeedbackTargetAnalytics.mockResolvedValue({ kind: 'private' })
    mocks.getGoogleReviewTargetAnalytics.mockResolvedValue({ kind: 'google' })

    await withStartContext(() =>
      getPrivateFeedbackTargetAnalyticsFn({ data: { propertyId: PROPERTY_ID } }),
    )
    expect(mocks.getPrivateFeedbackTargetAnalytics).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID },
      ACTOR,
    )
    expect(mocks.getGoogleReviewTargetAnalytics).not.toHaveBeenCalled()

    await withStartContext(() => getGoogleReviewTargetAnalyticsFn({ data: {} }))
    expect(mocks.getGoogleReviewTargetAnalytics).toHaveBeenCalledWith({}, ACTOR)
    const [googleScope] = mocks.getGoogleReviewTargetAnalytics.mock.calls[0]!
    expect(googleScope).not.toHaveProperty('propertyId')
    expect(mocks.getPrivateFeedbackTargetAnalytics).toHaveBeenCalledTimes(1)
  })

  it.each(analyticsReads)(
    'gates %s analytics on inbox.read, not organization.update',
    async (_name, invoke) => {
      mocks.getPrivateFeedbackTargetAnalytics.mockResolvedValue({})
      mocks.getGoogleReviewTargetAnalytics.mockResolvedValue({})

      await withStartContext(invoke)
      expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
        actor: ACTOR,
        action: 'inbox.read',
      })
      // "not organization.update" is the half that matters: a read must not be
      // gated on the write permission, even as a redundant extra gate call.
      expect(mocks.requireExecutionAllowed).not.toHaveBeenCalledWith({
        actor: ACTOR,
        action: 'organization.update',
      })
      expect(mocks.requireExecutionAllowed).toHaveBeenCalledTimes(1)
    },
  )

  it('writes an organization policy without inventing a property scope', async () => {
    mocks.setResponseTargetPolicy.mockResolvedValue({ policyVersion: 4 })

    await withStartContext(() => setResponseTargetPolicyFn({ data: organizationPolicy }))
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'organization.update',
    })
    const [input] = mocks.setResponseTargetPolicy.mock.calls[0]!
    expect(input).toEqual(organizationPolicy)
    expect(input).not.toHaveProperty('propertyId')
  })

  it('writes a property override, including the null that clears it', async () => {
    mocks.setResponseTargetPolicy.mockResolvedValue({ policyVersion: 5 })
    const override = {
      scope: 'property' as const,
      propertyId: PROPERTY_ID,
      durationMinutes: null,
      expectedPolicyVersion: 4,
    }

    await withStartContext(() => setResponseTargetPolicyFn({ data: override }))
    expect(mocks.setResponseTargetPolicy).toHaveBeenCalledWith(override, ACTOR)
  })

  it('surfaces a stale policy version as a 409 InboxError', async () => {
    mocks.setResponseTargetPolicy.mockRejectedValue(
      inboxError('revision_conflict', 'This target was changed by someone else'),
    )

    await expect(
      withStartContext(() => setResponseTargetPolicyFn({ data: organizationPolicy })),
    ).rejects.toMatchObject({
      _tag: 'InboxError',
      code: 'revision_conflict',
      status: 409,
    })
  })

  it('masks an untagged read failure and keeps its detail off the wire', async () => {
    const privateDetail = 'relation "inbox_response_target_policy" does not exist'
    mocks.getPrivateFeedbackTargetAnalytics.mockRejectedValue(new Error(privateDetail))

    const thrown = await withStartContext(() =>
      getPrivateFeedbackTargetAnalyticsFn({ data: {} }).then(
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

  it.each(deniedProbes)(
    'stops %s before any effect when execution is denied',
    async (_name, invoke, effect) => {
      mocks.requireExecutionAllowed.mockRejectedValue(new Error('execution denied'))

      await expect(withStartContext(invoke)).rejects.toThrow('execution denied')
      expect(effect).not.toHaveBeenCalled()
    },
  )
})
