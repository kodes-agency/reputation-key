import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  enforceRateLimit: vi.fn(),
  captureFeedback: vi.fn(),
  pseudonym: vi.fn((_: string, audience: string) => `safe-${audience}`),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({ rateLimiter: { check: vi.fn() } }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers({ cookie: 'session=current' })),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/config/env', () => ({
  getEnv: () => ({
    BETTER_AUTH_SECRET: 'feedback-secret',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  }),
}))
vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityFeedback: mocks.captureFeedback,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('./beta-feedback-rate-limit.server', () => ({
  enforceBetaFeedbackRateLimit: mocks.enforceRateLimit,
  betaFeedbackPseudonym: mocks.pseudonym,
}))

import { submitBetaFeedbackHandler } from './beta-feedback'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const actor = {
  organizationId: 'private-organization-id',
  userId: 'private-user-id',
  role: 'PropertyManager',
} as const

const bug = {
  type: 'bug',
  title: 'Reviews page did not load',
  expected: 'The reviews list should appear.',
  actual: 'The loading state remained on screen.',
  steps: 'Open a property and select Reviews.',
  impact: 'workaround_available',
  routePath: '/properties/private-property-id/reviews',
  viewport: 'wide',
} as const

describe('submit beta feedback server function', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.enforceRateLimit.mockResolvedValue(undefined)
    mocks.captureFeedback.mockReturnValue('a'.repeat(32))
  })

  it('submits allowlisted manager feedback and returns an opaque receipt', async () => {
    const result = await withStartContext(() => submitBetaFeedbackHandler({ data: bug }))

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: actor.userId,
        organizationId: actor.organizationId,
        keyHmacSecret: 'feedback-secret',
      }),
    )
    expect(mocks.captureFeedback).toHaveBeenCalledWith({
      message: expect.stringContaining('Title: Reviews page did not load'),
      source: 'repkey-native-beta-feedback',
      tags: {
        feedback_type: 'bug',
        feedback_impact: 'workaround_available',
        feedback_route: 'properties.property.reviews',
        feedback_actor: 'safe-telemetry-actor',
        feedback_organization: 'safe-telemetry-organization',
        feedback_viewport: 'wide',
        feedback_role: 'PropertyManager',
      },
    })
    expect(JSON.stringify(mocks.captureFeedback.mock.calls)).not.toContain(
      'private-property-id',
    )
    expect(JSON.stringify(mocks.captureFeedback.mock.calls)).not.toContain(actor.userId)
    expect(JSON.stringify(mocks.captureFeedback.mock.calls)).not.toContain(
      actor.organizationId,
    )
    expect(result).toEqual({ reference: 'a'.repeat(32) })
  })

  it('rejects Staff before consuming a feedback budget', async () => {
    mocks.resolveTenantContext.mockResolvedValue({ ...actor, role: 'Staff' })

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).rejects.toMatchObject({
      name: 'FeedbackError',
      code: 'forbidden',
      status: 403,
    })
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.captureFeedback).not.toHaveBeenCalled()
  })

  it('denies when current feedback permission is absent despite a PropertyManager label', async () => {
    mocks.resolveTenantContext.mockResolvedValue({
      ...actor,
      effectivePermissions: new Set(),
      scopeByPermission: new Map(),
    })

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).rejects.toMatchObject({
      name: 'FeedbackError',
      code: 'forbidden',
      status: 403,
    })
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.captureFeedback).not.toHaveBeenCalled()
  })

  it('uses current feedback permission rather than a stale Staff label', async () => {
    mocks.resolveTenantContext.mockResolvedValue({
      ...actor,
      role: 'Staff',
      effectivePermissions: new Set(['feedback.respond']),
      scopeByPermission: new Map([['feedback.respond', 'assigned-properties']]),
    })

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).resolves.toEqual({ reference: 'a'.repeat(32) })
    expect(mocks.enforceRateLimit).toHaveBeenCalledTimes(1)
    expect(mocks.captureFeedback).toHaveBeenCalledTimes(1)
  })

  it('does not capture when the abuse budget denies the submission', async () => {
    mocks.enforceRateLimit.mockRejectedValue(new Error('limited'))

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).rejects.toMatchObject({ name: 'InternalError', status: 500 })
    expect(mocks.captureFeedback).not.toHaveBeenCalled()
  })

  it('returns a stable unavailable response when delivery is not initialized', async () => {
    mocks.captureFeedback.mockReturnValue(undefined)

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).rejects.toMatchObject({
      name: 'FeedbackError',
      code: 'temporarily_unavailable',
      status: 503,
    })
  })
})
