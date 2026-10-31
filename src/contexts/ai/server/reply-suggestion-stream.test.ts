import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateReplySuggestionStreamFn } from './reply-suggestion-stream'
import { manageReplyDraftingRequests } from '../application/reply-drafting-requests'
import type { GenerateReplySuggestionDependencies } from '../application/reply-suggestion-contract'

const mocks = vi.hoisted(() => ({
  tenant: vi.fn(),
  source: vi.fn(),
  revision: vi.fn(),
  policy: vi.fn(),
  generate: vi.fn(),
  runtime: vi.fn(),
  signal: new AbortController().signal,
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options: { method: string }) => {
    let parse: (value: unknown) => unknown
    const builder = {
      validator(schema: { parse(value: unknown): unknown }) {
        parse = (value) => schema.parse(value)
        return builder
      },
      handler(handler: (input: { data: unknown }) => Promise<unknown>) {
        return (input: { data: unknown }) => {
          expect(options.method).toBe('POST')
          return handler({ data: parse(input.data) })
        }
      },
    }
    return builder
  },
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => ({ signal: mocks.signal }),
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    reviewPublicApi: {
      aiReviewSource: {
        readCurrentSource: mocks.source,
        readReplyStateRevision: mocks.revision,
      },
    },
    aiPublicApi: { generateReplySuggestion: mocks.generate },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => new Headers(),
}))
vi.mock('#/shared/auth/middleware', () => ({ resolveTenantContext: mocks.tenant }))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.policy,
}))
vi.mock('#/shared/ai-runtime-capability-contract', () => ({
  getAiRuntimeCapability: mocks.runtime,
}))

const data = {
  reviewId: '72000000-0000-4000-8000-000000000102',
  tone: 'professional' as const,
  targetLanguage: { kind: 'property_default' as const },
  idempotencyKey: '72000000-0000-4000-8000-000000000103',
  intent: 'explicit' as const,
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.tenant.mockResolvedValue({ organizationId: 'tenant', userId: 'manager' })
  mocks.source.mockResolvedValue({
    status: 'available',
    source: { propertyId: 'property', sourceEpoch: 2, sourceRevision: 3 },
  })
  mocks.revision.mockResolvedValue(4)
  mocks.runtime.mockReturnValue({ operationProfileVersion: 'reply-suggestion-v2' })
  mocks.generate.mockResolvedValue({
    status: 'unavailable',
    code: 'busy',
    retryAfterEpochMillis: 123,
  })
})
describe('authenticated drafting POST stream', () => {
  it('passes explicit undefined options through validation, the real dedupe wrapper and NDJSON', async () => {
    const execute = vi.fn(async () => ({
      status: 'unavailable' as const,
      code: 'busy' as const,
      retryAfterEpochMillis: 123,
    }))
    mocks.generate.mockImplementation(
      manageReplyDraftingRequests(
        {} as GenerateReplySuggestionDependencies,
        { parentOperationId: null, rewriteOrdinal: 0, rewriteIssues: [] },
        execute,
      ),
    )
    const response = await generateReplySuggestionStreamFn({
      data: { ...data, variation: undefined, length: undefined, maxWords: undefined },
    })
    expect(JSON.parse((await response.text()).trim())).toEqual({
      step: 'refused',
      reason: 'busy',
      retryAfterEpochMillis: 123,
      sequence: 1,
    })
    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        variation: undefined,
        length: undefined,
        maxWords: undefined,
      }),
    )
  })
  it('uses tenant-derived scope, current source/reply revisions and the same execution policy', async () => {
    const response = await generateReplySuggestionStreamFn({ data })
    expect(await response.text()).toContain('"reason":"busy"')
    expect(mocks.policy).toHaveBeenCalledWith({
      actor: { organizationId: 'tenant', userId: 'manager' },
      action: 'ai.reply.generate',
      propertyId: 'property',
    })
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'tenant',
        propertyId: 'property',
        actorUserId: 'manager',
        expectedSourceEpoch: 2,
        expectedSourceRevision: 3,
        expectedBaseReplyStateRevision: 4,
        onProgress: expect.any(Function),
      }),
    )
  })
  it('keeps the v2 endpoint dark under the served v1 selection', async () => {
    mocks.runtime.mockReturnValue({ operationProfileVersion: 'reply-suggestion-v1' })
    const response = await generateReplySuggestionStreamFn({ data })
    expect(await response.text()).toContain('policy_unavailable')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it.each(['tenant', 'policy'] as const)(
    'performs no generation after %s authorization fails',
    async (gate) => {
      mocks[gate].mockRejectedValue(new Error('denied'))
      await expect(generateReplySuggestionStreamFn({ data })).rejects.toThrow(
        'Internal server error',
      )
      expect(mocks.generate).not.toHaveBeenCalled()
    },
  )
  it('quietly defers background outcomes and rejects client scope/contract injection', async () => {
    const response = await generateReplySuggestionStreamFn({
      data: { ...data, intent: 'background' },
    })
    expect(await response.text()).toContain('"step":"deferred"')
    expect(() =>
      generateReplySuggestionStreamFn({
        data: { ...data, organizationId: 'other' } as never,
      }),
    ).toThrow(/Unrecognized key/u)
  })
})
