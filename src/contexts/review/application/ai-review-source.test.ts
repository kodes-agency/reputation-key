import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { createHash } from 'node:crypto'
import { canonicalizeRawAiReviewSourcePreviousRevision } from '#/shared/ai-review-source-contract'
import {
  computeAiReviewSourceProvenance,
  createAiReviewSource,
  matchStoredAiReviewSourceProvenance,
} from './ai-review-source'
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
      hasEvidenceBeforeStart: false,
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
      detectEvidenceBeforeStart: false,
    }
    await expect(source.readTrendPopulation(trendRequest)).resolves.toEqual({
      status: 'complete',
      reviews: [],
      hasEvidenceBeforeStart: false,
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

describe('matchStoredAiReviewSourceProvenance', () => {
  const MULTI_LINE = {
    text: 'Room was clean.\nStaff were kind.\nBreakfast could be better.',
    rating: 4 as const,
    languageCode: 'en',
    reviewedAtEpochMillis: 1_776_000_000_000,
    reviewerDisplayName: null,
  }

  function storedUnderRevisionOne(input: typeof MULTI_LINE) {
    const canonical = canonicalizeRawAiReviewSourcePreviousRevision(input)
    return {
      byteLength: canonical.bytes.byteLength,
      digest: createHash('sha256')
        .update('ai-source-v1\0', 'utf8')
        .update(canonical.bytes)
        .digest('hex'),
    }
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

  it('serves a row stored under revision 1 with the text its stored digest describes', () => {
    const stored = storedUnderRevisionOne(MULTI_LINE)
    const matched = matchStoredAiReviewSourceProvenance(MULTI_LINE, stored)
    expect(matched).toMatchObject({
      text: 'Room was clean.Staff were kind.Breakfast could be better.',
      digest: stored.digest,
      byteLength: stored.byteLength,
    })
  })

  it('answers null for a digest or a length that neither revision computes', () => {
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

  it('serves a row stored under revision 1 whose text the current rules would refuse as too long', () => {
    // 4,000 emoji, each followed by a line break: revision 1 deletes the breaks
    // (16,022 bytes), revision 2 keeps each as a space and passes the 16,384 limit.
    const long = { ...MULTI_LINE, text: '\u{1F600}\n'.repeat(4000) }
    expect(() => computeAiReviewSourceProvenance(long)).toThrow(
      'canonical source exceeds the operation byte limit',
    )
    const stored = storedUnderRevisionOne(long)
    expect(matchStoredAiReviewSourceProvenance(long, stored)).toMatchObject({
      digest: stored.digest,
      byteLength: stored.byteLength,
    })
  })

  it('still throws the current rules failure when no revision matches the stored row', () => {
    const long = { ...MULTI_LINE, text: '\u{1F600}\n'.repeat(4000) }
    expect(() =>
      matchStoredAiReviewSourceProvenance(long, {
        digest: '2'.repeat(64),
        byteLength: 10,
      }),
    ).toThrow('canonical source exceeds the operation byte limit')
  })

  it('answers null, rather than throwing, when only revision 1 cannot encode the text', () => {
    const accented = { ...MULTI_LINE, text: 'cafe\u200e\u0301' }
    expect(
      matchStoredAiReviewSourceProvenance(accented, {
        digest: '1'.repeat(64),
        byteLength: 10,
      }),
    ).toBeNull()
  })
})
