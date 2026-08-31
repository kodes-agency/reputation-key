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
    const readTrendPopulation = vi.fn(async () => ({
      status: 'complete' as const,
      reviews: [],
    }))
    const assertCurrentForAi = vi.fn(async () => ({ status: 'current' as const }))
    const findById = vi.fn(async () => ({
      organizationId: REQUEST.organizationId,
      propertyId: REQUEST.propertyId,
      id: REQUEST.reviewId,
      sourceEpoch: 4,
      sourceRevision: 9,
      analysisSequence: 12,
    }))
    const readReplyStateRevision = vi.fn(async () => 7)
    const source = createAiReviewSource({
      readForAi,
      readTrendPopulation,
      assertCurrentForAi,
      findById,
      readReplyStateRevision,
    })

    await expect(source.readForAi(REQUEST)).resolves.toEqual(available)
    await expect(source.assertCurrent(REQUEST)).resolves.toEqual({ status: 'current' })
    expect(readForAi).toHaveBeenCalledWith(REQUEST)
    expect(assertCurrentForAi).toHaveBeenCalledWith(REQUEST)
    const trendRequest = {
      organizationId: REQUEST.organizationId,
      propertyId: REQUEST.propertyId,
      sourceEpoch: 4,
      timezone: 'Europe/Sofia',
      calendarProfileVersion: 'property-calendar-v1' as const,
      startLocalDate: '2026-06-01',
      endLocalDate: '2026-07-30',
      limit: 10_001,
    }
    await expect(source.readTrendPopulation(trendRequest)).resolves.toEqual({
      status: 'complete',
      reviews: [],
    })
    expect(readTrendPopulation).toHaveBeenCalledWith(trendRequest)
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

  it('returns a content-free not-found result without leaking repository shape', async () => {
    const source = createAiReviewSource({
      readForAi: vi.fn(),
      readTrendPopulation: vi.fn(),
      assertCurrentForAi: vi.fn(),
      findById: vi.fn(async () => null),
      readReplyStateRevision: vi.fn(),
    })

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
