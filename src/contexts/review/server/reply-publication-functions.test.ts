// Review context — publication server function contracts.
// "Try publishing again" (retryPublishFn) and "Check Google again"
// (checkReplyPublicationFn) share one shape: POST, identifier-only input,
// tenant resolution, `reply.manage` before the Review API, and ReviewError →
// HTTP status. Runtime-imports the production module so the evidence cannot be
// satisfied by a detached copy of the handler.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { reviewError } from '../domain/errors'

type StandardValidator = Readonly<{
  '~standard': Readonly<{
    validate: (
      input: unknown,
    ) =>
      | Promise<{ value?: unknown; issues?: ReadonlyArray<unknown> }>
      | { value?: unknown; issues?: ReadonlyArray<unknown> }
  }>
}>

const mocks = vi.hoisted(() => ({
  retryPublish: vi.fn(),
  checkPublication: vi.fn(),
  headersFromContext: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options?: { method?: string }) => {
    let validator: StandardValidator | null = null
    const builder = {
      validator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (ctx: { data: unknown }) => Promise<unknown>) {
        // The declared HTTP method rides on the handler so each contract can be
        // asserted on its own, not by position among the module's re-exports.
        return Object.assign(
          async (opts: { data: unknown }) => {
            if (validator === null) throw new Error('server fn declared no validator')
            const parsed = await validator['~standard'].validate(opts.data)
            if (parsed.issues) throw new Error(JSON.stringify(parsed.issues))
            return fn({ data: parsed.value })
          },
          { method: options?.method ?? 'GET' },
        )
      },
    }
    return builder
  },
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    reviewPublicApi: {
      reply: {
        retryPublish: mocks.retryPublish,
        checkPublication: mocks.checkPublication,
      },
    },
  }),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: mocks.headersFromContext,
}))

vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))

vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))

import { checkReplyPublicationFn, retryPublishFn } from './reply'

const REVIEW_ID = '550e8400-e29b-41d4-a716-446655440000'
const ACTOR = {
  organizationId: '550e8400-e29b-41d4-a716-446655440002',
  userId: 'reply-publication-manager',
  role: 'PropertyManager',
} as unknown as AuthContext
const CHECK_RESULT = {
  reply: { id: '550e8400-e29b-41d4-a716-446655440003', status: 'publish_failed' },
  outcome: 'not_on_google',
  checkedAt: new Date('2026-09-14T12:00:00.000Z'),
  nextAutomaticCheckAt: new Date('2026-09-14T14:00:00.000Z'),
}

const callUnchecked = (fn: (input: { data: never }) => Promise<unknown>, data: unknown) =>
  fn({ data } as { data: never })

const FUNCTIONS = [
  ['retryPublishFn', retryPublishFn, mocks.retryPublish],
  ['checkReplyPublicationFn', checkReplyPublicationFn, mocks.checkPublication],
] as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headersFromContext.mockResolvedValue(new Headers())
  mocks.resolveTenantContext.mockResolvedValue(ACTOR)
  mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  mocks.retryPublish.mockResolvedValue(CHECK_RESULT.reply)
  mocks.checkPublication.mockResolvedValue(CHECK_RESULT)
})

describe('reply publication server functions', () => {
  it.each(FUNCTIONS)('%s is declared as a POST mutation', (_name, fn) => {
    expect(fn).toHaveProperty('method', 'POST')
  })

  it.each(FUNCTIONS)(
    '%s rejects a non-UUID review id before authorization',
    async (_name, fn, useCase) => {
      await expect(callUnchecked(fn, { reviewId: 'not-a-uuid' })).rejects.toThrow(
        /reviewId/u,
      )
      expect(mocks.resolveTenantContext).not.toHaveBeenCalled()
      expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
      expect(useCase).not.toHaveBeenCalled()
    },
  )

  it.each(FUNCTIONS)(
    '%s requires reply.manage before the Review API and forwards only the review id',
    async (_name, fn, useCase) => {
      await fn({ data: { reviewId: REVIEW_ID } })

      expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
        actor: ACTOR,
        action: 'reply.manage',
      })
      expect(useCase).toHaveBeenCalledWith({ reviewId: REVIEW_ID }, ACTOR)
      expect(mocks.requireExecutionAllowed.mock.invocationCallOrder[0]).toBeLessThan(
        useCase.mock.invocationCallOrder[0]!,
      )
    },
  )

  it.each(FUNCTIONS)(
    '%s stops before the Review API when authorization denies',
    async (_name, fn, useCase) => {
      mocks.requireExecutionAllowed.mockRejectedValueOnce(
        new ServerFunctionError(
          'AuthError',
          'Authorization denied',
          'permission_denied',
          403,
        ),
      )

      await expect(fn({ data: { reviewId: REVIEW_ID } })).rejects.toMatchObject({
        code: 'permission_denied',
        status: 403,
      })
      expect(useCase).not.toHaveBeenCalled()
    },
  )

  it.each(FUNCTIONS)(
    '%s maps a refusal to a 400 that carries the sentence the manager reads',
    async (_name, fn, useCase) => {
      const refusal = reviewError(
        'invalid_transition',
        'This reply has nothing to check on Google.',
      )
      useCase.mockRejectedValueOnce(refusal)

      await expect(fn({ data: { reviewId: REVIEW_ID } })).rejects.toMatchObject({
        name: 'ReviewError',
        code: 'invalid_transition',
        status: 400,
        message: refusal.message,
      })
    },
  )

  it('checkReplyPublicationFn returns the check result, never a retry', async () => {
    await expect(
      checkReplyPublicationFn({ data: { reviewId: REVIEW_ID } }),
    ).resolves.toEqual(CHECK_RESULT)
    expect(mocks.checkPublication).toHaveBeenCalledOnce()
    expect(mocks.retryPublish).not.toHaveBeenCalled()
  })

  it('checkReplyPublicationFn reports an unreachable Google as sync_failed', async () => {
    mocks.checkPublication.mockRejectedValueOnce(
      reviewError(
        'sync_failed',
        "RepKey couldn't reach Google to check this reply. Try again in a minute.",
      ),
    )

    await expect(
      checkReplyPublicationFn({ data: { reviewId: REVIEW_ID } }),
    ).rejects.toMatchObject({ code: 'sync_failed', status: 500 })
  })
})
