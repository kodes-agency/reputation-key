import { describe, expect, it, vi } from 'vitest'
import { manageReplyDraftingRequests } from './reply-drafting-requests'
import type {
  GenerateReplySuggestionDependencies,
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
} from './reply-suggestion-contract'
import type { ReplyDraftingProgressSink } from '#/shared/reply-drafting-progress'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'

const input: GenerateReplySuggestionInput = {
  organizationId: organizationId('tenant'),
  propertyId: propertyId('property'),
  reviewId: reviewId('review'),
  actorUserId: userId('manager'),
  tone: 'friendly',
  targetLanguage: { kind: 'review_language' },
  idempotencyKey: 'key',
  expectedSourceEpoch: 1,
  expectedSourceRevision: 2,
  expectedBaseReplyStateRevision: 3,
}
const attempt = { parentOperationId: null, rewriteOrdinal: 0, rewriteIssues: [] } as const
const result: GenerateReplySuggestionResult = {
  status: 'unavailable',
  code: 'source_changed',
  retryAfterEpochMillis: null,
}

describe('ephemeral active drafting ownership', () => {
  it('replays metadata to late duplicate starts and retires the promise at terminal outcome', async () => {
    let emit!: ReplyDraftingProgressSink
    let finish!: (value: GenerateReplySuggestionResult) => void
    const execute = vi.fn(async (request: GenerateReplySuggestionInput) => {
      emit = request.onProgress!
      return new Promise<GenerateReplySuggestionResult>((resolve) => {
        finish = resolve
      })
    })
    const generate = manageReplyDraftingRequests(
      {} as GenerateReplySuggestionDependencies,
      attempt,
      execute,
    )
    const first = generate(input)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    emit({ step: 'reading' })
    emit({ step: 'thinking' })
    emit({ step: 'answering', sentenceNumbers: [1] })
    emit({ step: 'writing' })
    const progress = vi.fn()
    const duplicate = generate({
      ...input,
      onProgress: progress,
      variation: undefined,
      length: undefined,
      maxWords: undefined,
      templateOnly: undefined,
      onIdentity: undefined,
    })
    expect(progress.mock.calls.map(([event]) => event.step)).toEqual([
      'reading',
      'thinking',
      'answering',
      'writing',
    ])
    finish(result)
    expect(await first).toEqual(await duplicate)
    const later = generate(input)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    finish(result)
    await later
  })
  it('isolates actors sharing a key', async () => {
    const execute = vi.fn(async () => result)
    const generate = manageReplyDraftingRequests(
      {} as GenerateReplySuggestionDependencies,
      attempt,
      execute,
    )
    await Promise.all([
      generate(input),
      generate({ ...input, actorUserId: userId('other-manager') }),
    ])
    expect(execute).toHaveBeenCalledTimes(2)
  })
})

it('measures a coalesced background generation once under the originating intent', async () => {
  const record = vi.fn(
    async (
      _measurement: import('#/shared/domain/draft-measurement').DraftGenerationMeasurement,
    ) => '4f000000-0000-4000-8000-000000000020',
  )
  let finish!: (value: GenerateReplySuggestionResult) => void
  const execute = vi.fn(async (request: GenerateReplySuggestionInput) => {
    request.onProgress?.({ step: 'reading' })
    return new Promise<GenerateReplySuggestionResult>((resolve) => {
      finish = resolve
    })
  })
  const generate = manageReplyDraftingRequests(
    {
      measurements: { record },
      nowEpochMillis: () => 10,
      reviewSources: { hasCurrentReply: async () => false },
    },
    attempt,
    execute,
  )
  const background = generate({ ...input, intent: 'background' })
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
  const explicit = generate(input)
  finish({
    status: 'ready',
    profileVersion: 'reply-draft-v4',
    replyText: 'PRIVATE DRAFT',
    provenanceToken: 'PRIVATE TOKEN',
    expiresAtEpochMillis: 100,
    baseReplyStateRevision: 3,
    concreteLanguageTag: 'en-Latn-US',
  })
  expect(await background).toEqual(await explicit)
  expect(record).toHaveBeenCalledOnce()
  expect(record.mock.calls[0]?.[0]).toMatchObject({
    intent: 'background',
    contract: 'v2',
  })
  expect(JSON.stringify(record.mock.calls)).not.toContain('PRIVATE')
})
