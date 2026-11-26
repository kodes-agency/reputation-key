import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { AiReviewSourceRefusal } from '#/shared/ai-review-source/ai-review-source-contract'
import {
  REFUSED_AI_SOURCE_BYTE_LENGTH,
  computeAiReviewSourceProvenance,
  createAiReviewSource,
  findStoredAiReviewSourceProvenance,
  matchStoredAiReviewSourceProvenance,
  storedAiReviewSourceProvenance,
} from './ai-review-source.server'
import type { AiReviewSourceRequest } from './ai-review-source.port.server'

const REQUEST: AiReviewSourceRequest = {
  organizationId: organizationId('org-ai-source'),
  propertyId: propertyId('property-ai-source'),
  reviewId: reviewId('review-ai-source'),
  expected: {
    kind: 'analysis',
    sourceEpoch: 4,
    sourceRevision: 9,
    analysisSequence: 12,
  },
}

const NO_REPOSITORY_CALL = vi.fn()

const repositoryWith = (findById: ReturnType<typeof vi.fn>) =>
  ({
    findById,
    hasCurrentReplyForAi: NO_REPOSITORY_CALL,
    readForAi: NO_REPOSITORY_CALL,
    readTrendPopulation: NO_REPOSITORY_CALL,
    assertCurrentForAi: NO_REPOSITORY_CALL,
    readReplyStateRevision: NO_REPOSITORY_CALL,
  }) as unknown as Parameters<typeof createAiReviewSource>[0]

describe('createAiReviewSource', () => {
  it('projects the six source fields of a live Review and nothing else', async () => {
    const findById = vi.fn(async () => ({
      organizationId: REQUEST.organizationId,
      propertyId: REQUEST.propertyId,
      id: REQUEST.reviewId,
      sourceEpoch: 4,
      sourceRevision: 9,
      analysisSequence: 12,
      text: 'not part of the source',
    }))
    const source = createAiReviewSource(repositoryWith(findById))

    await expect(
      source.readCurrentSource({
        organizationId: REQUEST.organizationId,
        reviewId: REQUEST.reviewId,
      }),
    ).resolves.toEqual({
      status: 'available',
      source: {
        organizationId: REQUEST.organizationId,
        propertyId: REQUEST.propertyId,
        reviewId: REQUEST.reviewId,
        sourceEpoch: 4,
        sourceRevision: 9,
        analysisSequence: 12,
      },
    })
    expect(findById).toHaveBeenCalledWith(REQUEST.reviewId, REQUEST.organizationId)
  })

  it('returns a content-free not-found result without leaking repository shape', async () => {
    const source = createAiReviewSource(repositoryWith(vi.fn(async () => null)))

    await expect(
      source.readCurrentSource({
        organizationId: REQUEST.organizationId,
        reviewId: REQUEST.reviewId,
      }),
    ).resolves.toEqual({ status: 'not_found' })
  })

  it('uses the shared raw canonicalizer for the persisted source digest and identity-minimized text', () => {
    const provenance = computeAiReviewSourceProvenance({
      text: 'Jane Doe thanked JANE DOE and typed [PERSON].',
      rating: 5,
      languageCode: 'en',
      reviewedAtEpochMillis: 1_776_000_000_000,
      reviewerDisplayName: 'Jane Doe',
    })

    expect(provenance.text).toBe('[PERSON] thanked [PERSON] and typed {#1#}.')
    expect(provenance.byteLength).toBeGreaterThan(0)
    expect(provenance.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.keys(provenance)).toEqual([
      'text',
      'rating',
      'languageCode',
      'reviewedAtEpochMillis',
      'byteLength',
      'digest',
    ])
  })
})

describe('matchStoredAiReviewSourceProvenance', () => {
  const MULTI_LINE = {
    text: 'Room was clean.\nStaff were kind.\nBreakfast could be better.',
    rating: 4 as const,
    languageCode: 'en',
    reviewedAtEpochMillis: 1_776_000_000_000,
    reviewerDisplayName: null,
  }

  it('serves a row stored under the current rules with the text of the current rules', () => {
    const current = computeAiReviewSourceProvenance(MULTI_LINE)
    const matched = matchStoredAiReviewSourceProvenance(MULTI_LINE, {
      digest: current.digest,
      byteLength: current.byteLength,
    })
    expect(matched?.text).toBe(
      'Room was clean. Staff were kind. Breakfast could be better.',
    )
  })

  it('answers null for a digest or a length the current rules do not compute', () => {
    const current = computeAiReviewSourceProvenance(MULTI_LINE)
    expect(
      matchStoredAiReviewSourceProvenance(MULTI_LINE, {
        digest: '0'.repeat(64),
        byteLength: current.byteLength,
      }),
    ).toBeNull()
    expect(
      matchStoredAiReviewSourceProvenance(MULTI_LINE, {
        digest: current.digest,
        byteLength: current.byteLength + 1,
      }),
    ).toBeNull()
  })

  it('still throws the current rules failure when the stored row does not match', () => {
    const long = { ...MULTI_LINE, text: '\u{1F600}\n'.repeat(4000) }
    expect(() =>
      matchStoredAiReviewSourceProvenance(long, {
        digest: '2'.repeat(64),
        byteLength: 10,
      }),
    ).toThrow('canonical source exceeds the operation byte limit')
  })
})

describe('a source the AI contract refuses', () => {
  const REFUSED = {
    // 497 x U+FDFA: 1,491 bytes raw, 16,401 once NFKC has expanded it.
    text: '\uFDFA'.repeat(497),
    rating: 4 as const,
    languageCode: 'en',
    reviewedAtEpochMillis: 1_776_000_000_000,
    reviewerDisplayName: null,
  }

  it('is stored marked one byte over the canonical limit, with a digest of its fields', () => {
    const stored = storedAiReviewSourceProvenance(REFUSED)

    expect(stored.byteLength).toBe(REFUSED_AI_SOURCE_BYTE_LENGTH)
    expect(REFUSED_AI_SOURCE_BYTE_LENGTH).toBe(16_385)
    expect(stored.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('has a digest that moves with the text, the rating, the language and the review date', () => {
    const base = storedAiReviewSourceProvenance(REFUSED).digest
    const edited = [
      { ...REFUSED, text: '\uFDFB'.repeat(497) },
      { ...REFUSED, rating: 5 as const },
      { ...REFUSED, languageCode: 'bg' },
      { ...REFUSED, reviewedAtEpochMillis: REFUSED.reviewedAtEpochMillis + 1 },
    ].map((input) => storedAiReviewSourceProvenance(input).digest)

    expect(new Set([base, ...edited]).size).toBe(5)
  })

  it('keeps the real digest of a source the contract accepts', () => {
    const accepted = { ...REFUSED, text: 'Room was clean.' }
    const computed = computeAiReviewSourceProvenance(accepted)

    expect(storedAiReviewSourceProvenance(accepted)).toEqual({
      byteLength: computed.byteLength,
      digest: computed.digest,
    })
  })

  it('is stored marked when the text holds an unpaired surrogate', () => {
    const stored = storedAiReviewSourceProvenance({ ...REFUSED, text: 'Nice\uD83D' })

    expect(stored.byteLength).toBe(REFUSED_AI_SOURCE_BYTE_LENGTH)
  })

  it('still throws what is not a refusal of the source', () => {
    const attempt = () => storedAiReviewSourceProvenance({ ...REFUSED, text: 5 as never })

    expect(attempt).toThrow(TypeError)
    expect(attempt).not.toThrow(AiReviewSourceRefusal)
  })

  it('describes no stored row, instead of failing, when looked up with findStored', () => {
    expect(
      findStoredAiReviewSourceProvenance(REFUSED, {
        digest: '3'.repeat(64),
        byteLength: 10,
      }),
    ).toBeNull()
  })
})
