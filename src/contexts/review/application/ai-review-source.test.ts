import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { computeAiReviewSourceProvenance, createAiReviewSource } from './ai-review-source'
import type { AiReviewSourceRequest } from './ports/ai-review-source.port'

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

describe('createAiReviewSource', () => {
  it('delegates reads and content-free currentness checks to the repository boundary', async () => {
    const available = {
      status: 'available' as const,
      observation: {
        kind: 'review' as const,
        reviewId: REQUEST.reviewId,
        organizationId: REQUEST.organizationId,
        propertyId: REQUEST.propertyId,
        text: '[PERSON] loved breakfast',
        rating: 5 as const,
        languageCode: 'en',
        reviewedAtEpochMillis: 1_776_000_000_000,
        contentExpiresAtEpochMillis: 1_778_000_000_000,
        sourceEpoch: 4,
        sourceRevision: 9,
        analysisSequence: 12,
      },
    }
    const readForAi = vi.fn(async () => available)
    const assertCurrentForAi = vi.fn(async () => ({ status: 'current' as const }))
    const readReplyStateRevision = vi.fn(async () => 7)
    const source = createAiReviewSource({
      readForAi,
      assertCurrentForAi,
      readReplyStateRevision,
    })

    await expect(source.readForAi(REQUEST)).resolves.toEqual(available)
    await expect(source.assertCurrent(REQUEST)).resolves.toEqual({ status: 'current' })
    expect(readForAi).toHaveBeenCalledWith(REQUEST)
    expect(assertCurrentForAi).toHaveBeenCalledWith(REQUEST)
    await expect(
      source.readReplyStateRevision({
        organizationId: REQUEST.organizationId,
        reviewId: REQUEST.reviewId,
      }),
    ).resolves.toBe(7)
    expect(readReplyStateRevision).toHaveBeenCalledWith(
      REQUEST.organizationId,
      REQUEST.reviewId,
    )
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
