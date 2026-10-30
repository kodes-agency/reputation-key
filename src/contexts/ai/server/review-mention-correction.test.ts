import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecutionPolicyModule from '#/shared/auth/execution-policy'
import type * as LoggerModule from '#/shared/observability/logger'
import type { AuthContext } from '#/shared/domain/auth-context'

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
  correctReviewMention: vi.fn(),
  readCurrentSource: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  headersFromContext: vi.fn(),
}))
const seam = vi.hoisted(() => ({ method: null as string | null }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options?: { method?: string }) => {
    let validator: StandardValidator | null = null
    const builder = {
      validator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (context: { data: unknown }) => Promise<unknown>) {
        seam.method = options?.method ?? 'GET'
        return async (options: { data: unknown }) => {
          if (validator === null) throw new Error('server fn declared no validator')
          const parsed = await validator['~standard'].validate(options.data)
          if (parsed.issues) throw new Error(JSON.stringify(parsed.issues))
          return fn({ data: parsed.value })
        }
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
    aiPublicApi: { correctReviewMention: mocks.correctReviewMention },
    reviewPublicApi: { aiReviewSource: { readCurrentSource: mocks.readCurrentSource } },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({ headersFromContext: mocks.headersFromContext }))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutionPolicyModule>()
  return { ...actual, requireExecutionAllowed: mocks.requireExecutionAllowed }
})

import { correctReviewMentionFn } from './review-mention-correction'
import { aiError } from '../domain/errors'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000021'
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000022'
const REVIEW_ID = '00000000-0000-4000-8000-000000000031'
const ACTOR = {
  organizationId: ORGANIZATION_ID,
  userId: 'user-correction-1',
  role: 'PropertyManager',
} as unknown as AuthContext

const call = (data: unknown) =>
  correctReviewMentionFn({ data } as Parameters<typeof correctReviewMentionFn>[0])

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  const outcome = await promise.then(
    (value) => ({ rejected: false as const, value }),
    (error: unknown) => ({ rejected: true as const, error }),
  )
  if (!outcome.rejected) {
    throw new Error(`expected rejection, received ${JSON.stringify(outcome.value)}`)
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
    source: {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      sourceEpoch: 2,
      sourceRevision: 5,
      analysisSequence: 8,
    },
  })
  mocks.correctReviewMention.mockResolvedValue({
    status: 'applied',
    mentionOrdinals: [1],
  })
})

describe('correctReviewMentionFn', () => {
  it('is a POST that corrects the analysis of the review’s current source', async () => {
    expect(seam.method).toBe('POST')

    await expect(
      call({ reviewId: REVIEW_ID, mentionOrdinal: 1, action: { kind: 'remove_topic' } }),
    ).resolves.toEqual({ status: 'applied', mentionOrdinals: [1] })

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'inbox.write',
      propertyId: PROPERTY_ID,
    })
    expect(mocks.correctReviewMention).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      sourceEpoch: 2,
      sourceRevision: 5,
      analysisSequence: 8,
      mentionOrdinal: 1,
      action: { kind: 'remove_topic' },
      actor: ACTOR,
    })
  })

  it('passes a changed cause through for the use case to fold and check', async () => {
    await call({
      reviewId: REVIEW_ID,
      mentionOrdinal: 0,
      action: { kind: 'change_cause', thing: 'Air Con', issue: null },
    })

    expect(mocks.correctReviewMention).toHaveBeenCalledWith(
      expect.objectContaining({
        action: { kind: 'change_cause', thing: 'Air Con', issue: null },
      }),
    )
  })

  it('answers 404 for a review that does not exist, before anything is authorized or written', async () => {
    mocks.readCurrentSource.mockResolvedValue({ status: 'not_found' })

    expect(
      await rejection(
        call({ reviewId: REVIEW_ID, mentionOrdinal: 0, action: { kind: 'undo' } }),
      ),
    ).toMatchObject({ _tag: 'AiError', code: 'not_found', status: 404 })
    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
    expect(mocks.correctReviewMention).not.toHaveBeenCalled()
  })

  it('authorizes the Inbox write before touching the AI command', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('denied'))

    await rejection(
      call({ reviewId: REVIEW_ID, mentionOrdinal: 0, action: { kind: 'undo' } }),
    )

    expect(mocks.correctReviewMention).not.toHaveBeenCalled()
  })

  it('answers a 403 when the use case refuses the reader for the Property', async () => {
    mocks.correctReviewMention.mockRejectedValue(
      aiError('forbidden', 'Property is not readable by this caller'),
    )

    expect(
      await rejection(
        call({ reviewId: REVIEW_ID, mentionOrdinal: 0, action: { kind: 'undo' } }),
      ),
    ).toMatchObject({ _tag: 'AiError', code: 'forbidden', status: 403 })
  })

  it.each([
    [
      'an ordinal beyond the answer’s bound',
      { mentionOrdinal: 48, action: { kind: 'undo' } },
    ],
    ['a negative ordinal', { mentionOrdinal: -1, action: { kind: 'undo' } }],
    ['an unknown action', { mentionOrdinal: 0, action: { kind: 'hide' } }],
    [
      'an action with a stray field',
      { mentionOrdinal: 0, action: { kind: 'undo', note: 'x' } },
    ],
    [
      'a cause phrase far over its bound',
      {
        mentionOrdinal: 0,
        action: { kind: 'change_cause', thing: 'x'.repeat(81), issue: null },
      },
    ],
  ])('refuses %s', async (_name, rest) => {
    await rejection(call({ reviewId: REVIEW_ID, ...rest }))

    expect(mocks.correctReviewMention).not.toHaveBeenCalled()
  })
})
