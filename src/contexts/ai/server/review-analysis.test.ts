// AI context — Review Analysis server function contract tests.
//
// Two functions share the module and answer different callers:
//
// - `requestReviewAnalysisNowFn` is fired by the Inbox pane when a manager keeps
//   a review open whose analysis still waits in the backlog. The stored review,
//   not the payload, names the Property: reading that review in the Inbox
//   (`inbox.read` on its Property) is the whole authority to hurry it, and only
//   the review id may arrive from the client.
// - `getReviewAnalysisProgressFn` is polled by the import wizard's setup step
//   for content-free counts, gated as a dashboard read of the Property.
//
// SEAM. Same seam as reply-publication-functions.test.ts: `@tanstack/react-start`
// is mocked with a minimal builder reproducing the production order —
// standard-schema validation first, then the handler, then its value — and the
// declared HTTP method rides on each returned function, so both contracts can
// be asserted from one module. `tracedHandler`, `catchUntagged`,
// `throwContextError` and the real zod DTOs stay unmocked.
//
// Pure unit tests — no database.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type {
  RequestReviewAnalysisNowResult,
  ReviewAnalysisProgress,
} from '#/contexts/ai/application/public-api'
import type { AiReviewCurrentSource } from '#/contexts/review/application/public-api'
import type * as ExecutionPolicyModule from '#/shared/auth/execution-policy'
import type { PolicyDenyReason } from '#/shared/auth/execution-policy'
import type * as LoggerModule from '#/shared/observability/logger'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'

/** The `~standard` surface createServerFn's execValidator prefers. */
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
  requestReviewAnalysisNow: vi.fn(),
  readReviewAnalysisProgress: vi.fn(),
  readCurrentSource: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  headersFromContext: vi.fn(),
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
        return Object.assign(
          async (opts: { data: unknown }) => {
            if (validator === null) throw new Error('server fn declared no validator')
            // Mirrors execValidator: validation precedes the handler, and a
            // failure surfaces as a plain Error the handler never sees.
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

vi.mock('#/shared/observability/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>()
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  }
  return { ...actual, getLogger: () => logger }
})

vi.mock('#/composition', () => ({
  getContainer: () => ({
    aiPublicApi: {
      requestReviewAnalysisNow: mocks.requestReviewAnalysisNow,
      readReviewAnalysisProgress: mocks.readReviewAnalysisProgress,
    },
    reviewPublicApi: {
      aiReviewSource: { readCurrentSource: mocks.readCurrentSource },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: mocks.headersFromContext,
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutionPolicyModule>()
  return { ...actual, requireExecutionAllowed: mocks.requireExecutionAllowed }
})

import {
  getReviewAnalysisProgressFn,
  requestReviewAnalysisNowFn,
} from './review-analysis'
import { ServerFunctionError } from '#/shared/auth/server-function-error'

// ── Sourced fixtures ────────────────────────────────────────────────

/** Compile-time sourced: a typo no longer type-checks against the union. */
const INBOX_READ: Permission = 'inbox.read'
const DASHBOARD_READ: Permission = 'dashboard.read'
const SCOPE_DENIED: PolicyDenyReason = 'scope_denied'

const REVIEW_ID = '00000000-0000-4000-8000-000000000041'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000042'
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000043'
/** A Property the client might name; only the stored review's Property counts. */
const OTHER_PROPERTY_ID = '00000000-0000-4000-8000-000000000044'

const ACTOR = {
  organizationId: ORGANIZATION_ID,
  userId: 'user-analysis-1',
  role: 'PropertyManager',
} as unknown as AuthContext

const STORED_REVIEW_SOURCE: AiReviewCurrentSource = {
  organizationId: organizationId(ORGANIZATION_ID),
  propertyId: propertyId(PROPERTY_ID),
  reviewId: reviewId(REVIEW_ID),
  sourceEpoch: 0,
  sourceRevision: 1,
  analysisSequence: 1,
}

/** Exhaustive over the use-case union: a new answer cannot ship unasserted. */
const REQUEST_ANSWERS: Readonly<Record<RequestReviewAnalysisNowResult['status'], true>> =
  {
    queued: true,
    not_pending: true,
    disabled: true,
  }

const ANALYSING: ReviewAnalysisProgress = {
  status: 'analysing',
  queued: 12,
  inProgress: 2,
  analysed: 30,
  notAnalysable: 4,
  verifiedThroughEpochMillis: null,
}

const DENIED = () =>
  new ServerFunctionError(
    'AuthError',
    `Authorization denied: ${SCOPE_DENIED}`,
    SCOPE_DENIED,
    403,
  )

const requestNow = () => requestReviewAnalysisNowFn({ data: { reviewId: REVIEW_ID } })
const readProgress = () =>
  getReviewAnalysisProgressFn({ data: { propertyId: PROPERTY_ID } })

/** Deliberately malformed payloads bypass the input type to reach the DTO. */
const requestNowUnchecked = (data: unknown) =>
  requestReviewAnalysisNowFn({ data } as Parameters<typeof requestReviewAnalysisNowFn>[0])
const readProgressUnchecked = (data: unknown) =>
  getReviewAnalysisProgressFn({
    data,
  } as Parameters<typeof getReviewAnalysisProgressFn>[0])

/** Capture a rejection without letting a resolved call silently pass. */
const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  const outcome = await promise.then(
    (value) => ({ rejected: false as const, value }),
    (error: unknown) => ({ rejected: true as const, error }),
  )
  if (!outcome.rejected) {
    throw new Error(
      `expected a rejection, resolved with ${JSON.stringify(outcome.value)}`,
    )
  }
  return outcome.error
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headersFromContext.mockResolvedValue(new Headers())
  mocks.resolveTenantContext.mockResolvedValue(ACTOR)
  mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  mocks.readCurrentSource.mockResolvedValue({
    status: 'available',
    source: STORED_REVIEW_SOURCE,
  })
  mocks.requestReviewAnalysisNow.mockResolvedValue({ status: 'queued' })
  mocks.readReviewAnalysisProgress.mockResolvedValue(ANALYSING)
})

describe('requestReviewAnalysisNowFn — the stored review is the authority', () => {
  it('is declared as a POST, because it enqueues work', () => {
    expect(requestReviewAnalysisNowFn).toHaveProperty('method', 'POST')
  })

  it('reads the review in the session Organization, then gates inbox.read on its Property', async () => {
    await requestNow()

    expect(mocks.readCurrentSource).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      reviewId: REVIEW_ID,
    })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: INBOX_READ,
      propertyId: PROPERTY_ID,
    })
    const [read] = mocks.readCurrentSource.mock.invocationCallOrder
    const [authorized] = mocks.requireExecutionAllowed.mock.invocationCallOrder
    const [requested] = mocks.requestReviewAnalysisNow.mock.invocationCallOrder
    expect(read).toBeLessThan(authorized!)
    expect(authorized).toBeLessThan(requested!)
  })

  it('hands exactly that review and its stored Property to the interactive lane', async () => {
    await requestNow()

    expect(mocks.requestReviewAnalysisNow).toHaveBeenCalledTimes(1)
    expect(mocks.requestReviewAnalysisNow).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
    })
  })

  it.each(Object.keys(REQUEST_ANSWERS) as ReadonlyArray<keyof typeof REQUEST_ANSWERS>)(
    'resolves the %s answer unchanged',
    async (status) => {
      const answer: RequestReviewAnalysisNowResult = { status }
      mocks.requestReviewAnalysisNow.mockResolvedValue(answer)

      await expect(requestNow()).resolves.toBe(answer)
    },
  )

  it('returns a tagged 404 and never authorizes or queues when the review is missing', async () => {
    mocks.readCurrentSource.mockResolvedValue({ status: 'not_found' })

    const error = await rejection(requestNow())

    expect(error).toBeInstanceOf(ServerFunctionError)
    expect(error).toMatchObject({
      name: 'AiError',
      code: 'not_found',
      status: 404,
      message: 'Review not found',
    })
    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
    expect(mocks.requestReviewAnalysisNow).not.toHaveBeenCalled()
  })

  it('surfaces an inbox.read denial as 403 and never queues the review', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(DENIED())

    await expect(requestNow()).rejects.toMatchObject({
      name: 'AuthError',
      code: SCOPE_DENIED,
      status: 403,
    })
    expect(mocks.requestReviewAnalysisNow).not.toHaveBeenCalled()
  })

  it('masks an untagged queue failure as a generic 500 and leaks no detail', async () => {
    mocks.requestReviewAnalysisNow.mockRejectedValue(
      new Error('AI on-demand review analysis queue is unavailable'),
    )

    const error = await rejection(requestNow())

    expect(error).toMatchObject({
      name: 'InternalError',
      code: 'internal_error',
      status: 500,
      message: 'Internal server error',
    })
    expect((error as Error).message).not.toContain('queue')
  })

  it.each([
    ['a non-UUID reviewId', { reviewId: 'nope' }, /"path":\["reviewId"\]/],
    ['a missing reviewId', {}, /"path":\["reviewId"\]/],
    [
      'a client-supplied Property',
      { reviewId: REVIEW_ID, propertyId: OTHER_PROPERTY_ID },
      /"code":"unrecognized_keys","keys":\["propertyId"\]/,
    ],
  ])(
    'rejects %s before any tenant, Review or policy work',
    async (_name, data, issue) => {
      // Per-case issue pattern: a validator that rejected for the wrong reason,
      // or quietly stopped refusing extra keys, would still fail here.
      await expect(requestNowUnchecked(data)).rejects.toThrow(issue)

      expect(mocks.resolveTenantContext).not.toHaveBeenCalled()
      expect(mocks.readCurrentSource).not.toHaveBeenCalled()
      expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
      expect(mocks.requestReviewAnalysisNow).not.toHaveBeenCalled()
    },
  )
})

describe('getReviewAnalysisProgressFn — a dashboard read of one Property', () => {
  it('is declared as a GET read', () => {
    expect(getReviewAnalysisProgressFn).toHaveProperty('method', 'GET')
  })

  it('authorizes dashboard.read on the requested Property before reading', async () => {
    await readProgress()

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: DASHBOARD_READ,
      propertyId: PROPERTY_ID,
    })
    const [authorized] = mocks.requireExecutionAllowed.mock.invocationCallOrder
    const [read] = mocks.readReviewAnalysisProgress.mock.invocationCallOrder
    expect(authorized).toBeLessThan(read!)
  })

  it('reads progress for the session Organization and that Property only', async () => {
    await readProgress()

    expect(mocks.readReviewAnalysisProgress).toHaveBeenCalledTimes(1)
    expect(mocks.readReviewAnalysisProgress).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
    })
    expect(mocks.readCurrentSource).not.toHaveBeenCalled()
  })

  it('returns the content-free counts unchanged', async () => {
    await expect(readProgress()).resolves.toBe(ANALYSING)
  })

  it('passes a disabled read straight through, so the step can render nothing', async () => {
    const disabled: ReviewAnalysisProgress = { status: 'disabled' }
    mocks.readReviewAnalysisProgress.mockResolvedValue(disabled)

    await expect(readProgress()).resolves.toBe(disabled)
  })

  it('surfaces a scope denial as 403 and never reaches the progress read', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(DENIED())

    await expect(readProgress()).rejects.toMatchObject({
      name: 'AuthError',
      code: SCOPE_DENIED,
      status: 403,
    })
    expect(mocks.readReviewAnalysisProgress).not.toHaveBeenCalled()
  })

  it('masks an untagged read failure as a generic 500 and leaks no detail', async () => {
    mocks.readReviewAnalysisProgress.mockRejectedValue(
      new Error('select count(*) from ai_review_analysis_backlog failed: timeout'),
    )

    const error = await rejection(readProgress())

    expect(error).toMatchObject({
      name: 'InternalError',
      code: 'internal_error',
      status: 500,
    })
    expect((error as Error).message).not.toContain('ai_review_analysis_backlog')
  })

  it.each([
    ['a non-UUID propertyId', { propertyId: 'property-1' }, /"path":\["propertyId"\]/],
    ['a missing propertyId', {}, /"path":\["propertyId"\]/],
    [
      'a client-supplied Organization',
      { propertyId: PROPERTY_ID, organizationId: ORGANIZATION_ID },
      /"code":"unrecognized_keys","keys":\["organizationId"\]/,
    ],
  ])('rejects %s before resolving the tenant', async (_name, data, issue) => {
    await expect(readProgressUnchecked(data)).rejects.toThrow(issue)

    expect(mocks.resolveTenantContext).not.toHaveBeenCalled()
    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
    expect(mocks.readReviewAnalysisProgress).not.toHaveBeenCalled()
  })
})
