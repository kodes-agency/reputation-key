// AI context — `generateReplySuggestionFn` server function contract tests.
//
// This is the exact path a user clicks in the inbox reply editor, so both the
// resolved value and the thrown value are contracts:
// src/components/inbox/use-reply-suggestion.ts renders distinct copy for the
// `language_not_supported`, `not_authorized` and `source_changed` unavailable
// codes, which means they must arrive as RESOLVED values with their code intact —
// collapsing any of them into a thrown error silently degrades the UI to the
// generic "try again" message.
//
// SEAM. The module exports only the wrapped `createServerFn` value, and invoking
// that value directly (the seam in google-performance.test.ts) cannot observe the
// handler's return value: without the Start vite transform, `.handler(fn)` receives
// one argument, so the framework stores `fn` as `extractedFn`, leaves `serverFn`
// undefined, and the client middleware branch discards the resolved value. So
// `@tanstack/react-start` is mocked with a minimal builder reproducing the
// production order read off createServerFn.js: standard-schema validation first,
// then the handler, then the handler's value returned. `tracedHandler`,
// `catchUntagged`, `throwContextError` and the real zod DTO stay unmocked.
//
// Pure unit tests — no database.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REPLY_TONES } from '#/shared/ai-reply-template-catalogue'
import { propertyId } from '#/shared/domain/ids'
import type { Review } from '#/contexts/review/domain/types'
import type { GenerateReplySuggestionResult } from '#/contexts/ai/application/use-cases/generate-reply-suggestion'
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
  generateReplySuggestion: vi.fn(),
  findById: vi.fn(),
  readReplyStateRevision: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  headersFromContext: vi.fn(),
  setResponseHeader: vi.fn(),
}))

/** Declared HTTP method, captured from the module's own createServerFn call. */
const seam = vi.hoisted(() => ({ method: null as string | null }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options?: { method?: string }) => {
    let validator: StandardValidator | null = null
    const builder = {
      inputValidator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (ctx: { data: unknown }) => Promise<unknown>) {
        seam.method = options?.method ?? 'GET'
        return async (opts: { data: unknown }) => {
          if (validator === null) throw new Error('server fn declared no inputValidator')
          // Mirrors execValidator: validation precedes the handler, and a failure
          // surfaces as a plain Error the handler never sees.
          const parsed = await validator['~standard'].validate(opts.data)
          if (parsed.issues) throw new Error(JSON.stringify(parsed.issues))
          return fn({ data: parsed.value })
        }
      },
    }
    return builder
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: mocks.setResponseHeader,
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
    useCases: { generateReplySuggestion: mocks.generateReplySuggestion },
    reviewRepo: {
      findById: mocks.findById,
      readReplyStateRevision: mocks.readReplyStateRevision,
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

import { generateReplySuggestionFn } from './reply-suggestion'
import { ServerFunctionError } from '#/shared/auth/server-errors'

// ── Sourced fixtures ────────────────────────────────────────────────

/** Compile-time sourced: a typo no longer type-checks against the union. */
const REPLY_GENERATE: Permission = 'ai.reply.generate'
const PERMISSION_DENIED: PolicyDenyReason = 'permission_denied'

type UnavailableCode = Extract<
  GenerateReplySuggestionResult,
  { status: 'unavailable' }
>['code']

const REVIEW_ID = '00000000-0000-4000-8000-000000000021'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000022'
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000023'
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000024'

const ACTOR = {
  organizationId: ORGANIZATION_ID,
  userId: 'user-reply-1',
  role: 'AccountAdmin',
} as unknown as AuthContext

/**
 * A never-edited review: the property binding has never been re-generated, so
 * `sourceEpoch` sits at its floor of 0, while `sourceRevision` starts at 1 for
 * a first observation (see reviewFromSource in review/domain/types).
 */
const NEVER_EDITED_REVIEW: Pick<Review, 'propertyId' | 'sourceEpoch' | 'sourceRevision'> =
  {
    propertyId: propertyId(PROPERTY_ID),
    sourceEpoch: 0,
    sourceRevision: 1,
  }

/** No reply has ever been drafted for this review. */
const NEVER_REPLIED_STATE_REVISION = 0

const READY: GenerateReplySuggestionResult = {
  status: 'ready',
  replyText: 'Thank you for the detailed feedback.',
  provenanceToken: 'provenance-token-1',
  expiresAtEpochMillis: 0,
  baseReplyStateRevision: NEVER_REPLIED_STATE_REVISION,
}

/**
 * Exhaustive over the use-case union: adding an unavailable code without adding
 * it here is a compile error, so a new degradation cannot ship unasserted.
 * `retryAfterEpochMillis` separates "retry later" from terminal outcomes.
 */
const RETRY_AT = 1_700_000_000_000
const UNAVAILABLE_RETRY_AFTER: Readonly<Record<UnavailableCode, number | null>> = {
  not_authorized: null,
  source_changed: null,
  language_not_supported: null,
  completed_without_delivery: null,
  policy_unavailable: RETRY_AT,
  provider_unavailable: RETRY_AT,
}

/** The codes use-reply-suggestion.ts renders bespoke copy for. */
const HOOK_DISTINGUISHED_CODES: ReadonlyArray<UnavailableCode> = [
  'language_not_supported',
  'not_authorized',
  'source_changed',
]

const NO_STORE_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Cache-Control', 'private, no-store, max-age=0'],
  ['Pragma', 'no-cache'],
  ['Expires', '0'],
]

const call = (overrides?: Partial<{ reviewId: string; idempotencyKey: string }>) =>
  generateReplySuggestionFn({
    data: {
      reviewId: overrides?.reviewId ?? REVIEW_ID,
      tone: 'professional',
      idempotencyKey: overrides?.idempotencyKey ?? IDEMPOTENCY_KEY,
    },
  })

/** Deliberately malformed payloads bypass the input type to reach the DTO. */
const callUnchecked = (data: unknown) =>
  generateReplySuggestionFn({ data } as Parameters<typeof generateReplySuggestionFn>[0])

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
  mocks.findById.mockResolvedValue(NEVER_EDITED_REVIEW)
  mocks.readReplyStateRevision.mockResolvedValue(NEVER_REPLIED_STATE_REVISION)
  mocks.generateReplySuggestion.mockResolvedValue(READY)
})

describe('generateReplySuggestionFn — request shaping', () => {
  it('is declared as a POST mutation', () => {
    // A GET here would make generated AI content cacheable by intermediaries and
    // reachable by cross-site navigation.
    expect(seam.method).toBe('POST')
  })

  it('forwards the review source version and reply base revision at their floors', async () => {
    await call()

    // Every field is asserted at once: a dropped or renamed expectation (notably
    // an epoch of 0 lost to a falsy check) would let the use case compare against
    // undefined and skip its staleness fence.
    expect(mocks.generateReplySuggestion).toHaveBeenCalledTimes(1)
    expect(mocks.generateReplySuggestion).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      actorUserId: ACTOR.userId,
      tone: 'professional',
      idempotencyKey: IDEMPOTENCY_KEY,
      expectedSourceEpoch: 0,
      expectedSourceRevision: NEVER_EDITED_REVIEW.sourceRevision,
      expectedBaseReplyStateRevision: NEVER_REPLIED_STATE_REVISION,
    })
  })

  it('scopes both repository reads to the resolved tenant in the argument order each port declares', async () => {
    await call()

    // findById takes (reviewId, organizationId); readReplyStateRevision takes
    // (organizationId, reviewId). Swapping either pair is a cross-tenant read.
    expect(mocks.findById).toHaveBeenCalledWith(REVIEW_ID, ORGANIZATION_ID)
    expect(mocks.readReplyStateRevision).toHaveBeenCalledWith(ORGANIZATION_ID, REVIEW_ID)
  })

  it('gates on ai.reply.generate scoped to the property the review belongs to', async () => {
    await call()

    // The property comes from the stored review, never from the client payload.
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: REPLY_GENERATE,
      propertyId: PROPERTY_ID,
    })
  })

  it.each(REPLY_TONES)('accepts the catalogued %s tone and forwards it', async (tone) => {
    await generateReplySuggestionFn({
      data: { reviewId: REVIEW_ID, tone, idempotencyKey: IDEMPOTENCY_KEY },
    })

    // Keeps the DTO enum aligned with the reply template catalogue: a tone added
    // to REPLY_TONES without widening the DTO fails here.
    expect(mocks.generateReplySuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ tone }),
    )
  })
})

describe('generateReplySuggestionFn — AI content is never cached', () => {
  it('sets the full no-store triple on a successful generation', async () => {
    await call()

    expect(mocks.setResponseHeader.mock.calls).toEqual(
      NO_STORE_HEADERS.map((header) => [...header]),
    )
  })

  it('still suppresses caching when the review is missing', async () => {
    mocks.findById.mockResolvedValue(null)

    await rejection(call())

    // Cache suppression must precede the lookup: a 404 body is still an AI-path
    // response and must not be stored by an intermediary.
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store, max-age=0',
    )
    expect(mocks.setResponseHeader).toHaveBeenCalledTimes(NO_STORE_HEADERS.length)
  })
})

describe('generateReplySuggestionFn — resolved outcomes reach the hook intact', () => {
  it('returns the ready suggestion verbatim, including a base revision of 0', async () => {
    const result = await call()

    expect(result).toEqual(READY)
    expect(result).toMatchObject({ baseReplyStateRevision: 0 })
  })

  it.each(
    Object.entries(UNAVAILABLE_RETRY_AFTER) as ReadonlyArray<
      [UnavailableCode, number | null]
    >,
  )(
    'resolves with the %s code instead of throwing',
    async (code, retryAfterEpochMillis) => {
      const unavailable: GenerateReplySuggestionResult = {
        status: 'unavailable',
        code,
        retryAfterEpochMillis,
      }
      mocks.generateReplySuggestion.mockResolvedValue(unavailable)

      const result = await call()

      // use-reply-suggestion.ts switches on `code`; a thrown error or a rewritten
      // code would collapse bespoke guidance into the generic retry message.
      expect(result).toEqual(unavailable)
      expect(result).toMatchObject({ status: 'unavailable', code, retryAfterEpochMillis })
    },
  )

  it('keeps every code the reply hook distinguishes inside the use-case union', () => {
    // Guards the direction the per-code tests cannot: a code deleted from the
    // use case while the hook still branches on it.
    for (const code of HOOK_DISTINGUISHED_CODES) {
      expect(UNAVAILABLE_RETRY_AFTER).toHaveProperty(code)
    }
    expect(UNAVAILABLE_RETRY_AFTER.language_not_supported).toBeNull()
    expect(UNAVAILABLE_RETRY_AFTER.provider_unavailable).toBe(RETRY_AT)
  })
})

describe('generateReplySuggestionFn — failure surfaces', () => {
  it('returns a tagged 404 and never authorizes or generates when the review is missing', async () => {
    mocks.findById.mockResolvedValue(null)

    const error = await rejection(call())

    expect(error).toBeInstanceOf(ServerFunctionError)
    expect(error).toMatchObject({
      name: 'AiError',
      code: 'not_found',
      status: 404,
      message: 'Review not found',
    })
    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
    expect(mocks.readReplyStateRevision).not.toHaveBeenCalled()
    expect(mocks.generateReplySuggestion).not.toHaveBeenCalled()
  })

  it('surfaces a policy denial as 403 and never reaches the generator', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(
      new ServerFunctionError(
        'AuthError',
        `Authorization denied: ${PERMISSION_DENIED}`,
        PERMISSION_DENIED,
        403,
      ),
    )

    await expect(call()).rejects.toMatchObject({
      name: 'AuthError',
      code: PERMISSION_DENIED,
      status: 403,
    })
    expect(mocks.readReplyStateRevision).not.toHaveBeenCalled()
    expect(mocks.generateReplySuggestion).not.toHaveBeenCalled()
  })

  it('masks an untagged repository failure as a generic 500 and leaks no detail', async () => {
    mocks.findById.mockRejectedValue(
      new Error('select * from reviews where id = $1 failed: connection terminated'),
    )

    const error = await rejection(call())

    expect(error).toMatchObject({
      name: 'InternalError',
      code: 'internal_error',
      status: 500,
      message: 'Internal server error',
    })
    expect((error as Error).message).not.toContain('select * from reviews')
  })

  it('masks an untagged generator failure without inventing an unavailable code', async () => {
    mocks.generateReplySuggestion.mockRejectedValue(new Error('inference pool exhausted'))

    const error = await rejection(call())

    // A crash must not be laundered into a resolved `unavailable` payload — the
    // hook would then show a soft message for a hard failure.
    expect(error).toMatchObject({
      name: 'InternalError',
      code: 'internal_error',
      status: 500,
    })
  })

  it('preserves a tagged generator error instead of collapsing it to 500', async () => {
    mocks.generateReplySuggestion.mockRejectedValue(
      new ServerFunctionError(
        'AiError',
        'Daily AI quota reached',
        'quota_exhausted',
        429,
      ),
    )

    await expect(call()).rejects.toMatchObject({
      name: 'AiError',
      code: 'quota_exhausted',
      status: 429,
    })
  })
})

describe('generateReplySuggestionFn — input validation fences the tenant path', () => {
  it.each([
    [
      'a non-UUID reviewId',
      { reviewId: 'nope', tone: 'professional', idempotencyKey: IDEMPOTENCY_KEY },
      /"path":\["reviewId"\]/,
    ],
    [
      'a non-UUID idempotencyKey',
      { reviewId: REVIEW_ID, tone: 'professional', idempotencyKey: 'retry-1' },
      /"path":\["idempotencyKey"\]/,
    ],
    [
      'an uncatalogued tone',
      { reviewId: REVIEW_ID, tone: 'shouty', idempotencyKey: IDEMPOTENCY_KEY },
      /"path":\["tone"\]/,
    ],
    [
      'a missing idempotencyKey',
      { reviewId: REVIEW_ID, tone: 'professional' },
      /"path":\["idempotencyKey"\]/,
    ],
    [
      'a missing tone',
      { reviewId: REVIEW_ID, idempotencyKey: IDEMPOTENCY_KEY },
      /"path":\["tone"\]/,
    ],
  ])(
    'rejects %s before any tenant, repository or policy work',
    async (_name, data, path) => {
      // Per-case path pattern: a validator that rejected for the wrong reason,
      // or stopped checking one field, would still fail here.
      await expect(callUnchecked(data)).rejects.toThrow(path)

      expect(mocks.resolveTenantContext).not.toHaveBeenCalled()
      expect(mocks.findById).not.toHaveBeenCalled()
      expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
      expect(mocks.generateReplySuggestion).not.toHaveBeenCalled()
      // Nothing was emitted, so there is no response to suppress caching on.
      expect(mocks.setResponseHeader).not.toHaveBeenCalled()
    },
  )

  it('rejects an unparsable reviewId even when the review would exist', async () => {
    // The DTO, not the repository, is what stops a malformed identifier: without
    // it a raw string would be branded and handed to the tenant-scoped query.
    await expect(call({ reviewId: `${REVIEW_ID} OR 1=1` })).rejects.toThrow(
      /"path":\["reviewId"\]/,
    )

    expect(mocks.findById).not.toHaveBeenCalled()
  })
})
