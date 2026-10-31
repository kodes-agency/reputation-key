import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { measureReplyDrafting } from './reply-drafting-measurement'
import type {
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
} from './reply-suggestion-contract'

const input: GenerateReplySuggestionInput = {
  organizationId: organizationId('tenant'),
  propertyId: propertyId('4f000000-0000-4000-8000-000000000001'),
  reviewId: reviewId('4f000000-0000-4000-8000-000000000010'),
  actorUserId: userId('manager'),
  idempotencyKey: '4f000000-0000-4000-8000-000000000020',
  tone: 'professional',
  targetLanguage: { kind: 'property_default' },
  expectedSourceEpoch: 1,
  expectedSourceRevision: 1,
  expectedBaseReplyStateRevision: 0,
}
const ready: GenerateReplySuggestionResult = {
  status: 'ready',
  profileVersion: 'reply-draft-v3',
  replyText: 'PRIVATE DRAFT',
  provenanceToken: 'PRIVATE TOKEN',
  expiresAtEpochMillis: 100,
  baseReplyStateRevision: 0,
  concreteLanguageTag: 'en-Latn-US',
}

describe('logical draft measurement boundary', () => {
  it('records only controlled metadata and returns an independent identity', async () => {
    const record = vi.fn(async () => input.idempotencyKey)
    const generate = measureReplyDrafting(
      { measurements: { record }, nowEpochMillis: () => 10 },
      'v1',
      async () => ready,
    )
    expect(await generate(input)).toMatchObject({
      measurementGenerationId: input.idempotencyKey,
      replyText: 'PRIVATE DRAFT',
    })
    expect(record).toHaveBeenCalledWith({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reviewId: input.reviewId,
      actorUserId: input.actorUserId,
      requestKey: input.idempotencyKey,
      intent: 'explicit',
      trigger: 'draft',
      contract: 'v1',
      outcome: 'ready',
      refusalCode: null,
      case: null,
      latencyMs: 0,
    })
    expect(JSON.stringify(record.mock.calls)).not.toContain('PRIVATE')
  })
  it('keeps delivery behavior when advisory measurement storage fails', async () => {
    const warn = vi.fn()
    const generate = measureReplyDrafting(
      {
        logger: { warn },
        measurements: {
          record: async () => {
            throw new Error('PRIVATE query and params', {
              cause: Object.assign(new Error('PRIVATE database failure'), {
                code: '55P03',
              }),
            })
          },
        },
        nowEpochMillis: () => 10,
      },
      'v1',
      async () => ready,
    )
    expect(await generate(input)).toBe(ready)
    expect(warn).toHaveBeenCalledWith(
      { errorName: 'Error', errorCode: '55P03' },
      'Draft measurement failed',
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE')
  })
  it('does not count local catalogue output as a provider generation', async () => {
    const record = vi.fn(async () => null)
    const fallback: GenerateReplySuggestionResult = {
      status: 'fallback',
      kind: 'local_safe_template',
      reason: 'no_review_text',
      languageSource: 'explicit',
      replyText: 'local text',
      concreteLanguageTag: 'en-Latn-US',
    }
    const generate = measureReplyDrafting(
      { measurements: { record }, nowEpochMillis: () => 10 },
      'v2',
      async () => fallback,
    )
    expect(await generate(input)).toBe(fallback)
    expect(record).not.toHaveBeenCalled()
  })
})

it('warns when storage skips a measurement without changing draft delivery', async () => {
  const warn = vi.fn()
  const generate = measureReplyDrafting(
    {
      measurements: { record: async () => null },
      logger: { warn },
      nowEpochMillis: () => 10,
    },
    'v1',
    async () => ready,
  )
  expect(await generate(input)).toBe(ready)
  expect(warn).toHaveBeenCalledWith(
    { errorCode: 'measurement_not_recorded' },
    'Draft measurement skipped',
  )
})
