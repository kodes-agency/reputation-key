// Inbox context — "check this review on Google" server function tests.
// Imports and invokes the actual createServerFn handler, like the sibling
// server-function suites: the wrapper resolves to undefined outside the server
// runtime and `.validator()` does not run, so the assertions are on the gate,
// the arguments forwarded to the use case, and the errors that propagate.

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkInboxReviewOnGoogle: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    inboxPublicApi: { checkInboxReviewOnGoogle: mocks.checkInboxReviewOnGoogle },
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
import { checkReviewOnGoogleFn } from './inbox-google-check'

const REVIEW_ID = '850e8400-e29b-41d4-a716-446655440000'

const ACTOR = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  userId: 'user-manager-1',
  role: 'PropertyManager',
} as const

describe('checkReviewOnGoogleFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('gates the check on inbox.read and forwards the review to the use case', async () => {
    mocks.checkInboxReviewOnGoogle.mockResolvedValue({ outcome: 'no_reply' })

    await withStartContext(() => checkReviewOnGoogleFn({ data: { reviewId: REVIEW_ID } }))

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'inbox.read',
    })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledTimes(1)
    expect(mocks.checkInboxReviewOnGoogle).toHaveBeenCalledWith(
      { reviewId: REVIEW_ID },
      ACTOR,
    )
  })

  it('reads nothing from Google when execution is denied', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('execution denied'))

    await expect(
      withStartContext(() => checkReviewOnGoogleFn({ data: { reviewId: REVIEW_ID } })),
    ).rejects.toThrow('execution denied')
    expect(mocks.checkInboxReviewOnGoogle).not.toHaveBeenCalled()
  })

  it('surfaces an Inbox refusal as a tagged InboxError', async () => {
    mocks.checkInboxReviewOnGoogle.mockRejectedValue(
      inboxError('not_found', 'This review is not in your Inbox'),
    )

    await expect(
      withStartContext(() => checkReviewOnGoogleFn({ data: { reviewId: REVIEW_ID } })),
    ).rejects.toMatchObject({ _tag: 'InboxError', code: 'not_found' })
  })
})
