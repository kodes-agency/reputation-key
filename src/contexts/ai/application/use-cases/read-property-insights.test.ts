import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import type {
  AiPropertyAnalyzedReview,
  AiPropertyUnavailableReview,
} from '../ports/ai-property-aggregate-store.port'
import {
  createReadPropertyInsights,
  type AiPropertyInsightsRead,
  type ReadPropertyInsightsDependencies,
} from './read-property-insights'

const ORGANIZATION_ID = organizationId('11111111-1111-4111-8111-111111111111')
const PROPERTY_ID = propertyId('22222222-2222-4222-8222-222222222222')
const ACTOR_USER_ID = userId('33333333-3333-4333-8333-333333333333')
const NOW = Date.UTC(2026, 7, 20, 3, 0, 0)

function versionId(sequence: number) {
  return reviewId(`00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`)
}

function populationReview(
  sequence: number,
  localDate: string,
  options: Readonly<{ hasText?: boolean; rating?: 1 | 2 | 3 | 4 | 5 }> = {},
) {
  return Object.freeze({
    reviewId: versionId(sequence),
    sourceRevision: 1,
    analysisSequence: sequence,
    localDate,
    hasText: options.hasText ?? true,
    rating: options.rating ?? 5,
  })
}

function analyzedReview(
  sequence: number,
  localDate: string,
  options: Readonly<{
    rating?: number
    aspect?: 'service' | 'room' | 'cleanliness'
    polarity?: 'positive' | 'neutral' | 'negative'
    intensity?: number
    issueLabel?: string | null
  }> = {},
): AiPropertyAnalyzedReview {
  const polarity = options.polarity ?? 'positive'
  return Object.freeze({
    reviewId: versionId(sequence),
    sourceRevision: 1,
    analysisSequence: sequence,
    localDate,
    rating: options.rating ?? 5,
    sentiment: polarity === 'negative' ? 'negative' : 'positive',
    attention: 'low',
    aspects: Object.freeze([
      Object.freeze({
        aspect: options.aspect ?? 'service',
        polarity,
        intensity: options.intensity ?? 100,
      }),
    ]),
    issueLabel: options.issueLabel ?? null,
    analysisProfileVersion: 'review-analysis-v2',
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    modelSnapshot: 'gpt-5-mini-2025-08-07',
  })
}

function unavailableReview(
  sequence: number,
  localDate: string,
  rating: number,
): AiPropertyUnavailableReview {
  return Object.freeze({
    reviewId: versionId(sequence),
    sourceRevision: 1,
    analysisSequence: sequence,
    localDate,
    rating,
    reason: 'language_not_supported',
  })
}

function harness(
  options: Readonly<{
    capabilities?: readonly string[]
    localDate?: string | null
    aggregate?: unknown
    population?: unknown
  }> = {},
) {
  const readWindow = vi.fn(async () =>
    options.aggregate === undefined
      ? {
          head: {},
          days: [],
          analyzedReviews: [],
          unavailableReviews: [],
        }
      : options.aggregate,
  )
  const readTrendPopulation = vi.fn(async () =>
    options.population === undefined
      ? {
          status: 'complete' as const,
          reviews: [],
          hasEvidenceBeforeStart: false,
        }
      : options.population,
  )
  const resolveLocalDate = vi.fn(async () =>
    options.localDate === undefined ? '2026-08-20' : options.localDate,
  )
  const read = createReadPropertyInsights({
    authorization: {
      readMerchantAuthorization: vi.fn(async () => ({
        state: 'enabled',
        authorizationLineageId: 'lineage-1',
        capabilities: options.capabilities ?? ['review_analysis'],
        authorizedSourceEpoch: 7,
        capabilityEpochs: {
          review_analysis: { epoch: 4 },
          property_trends: { epoch: 9 },
        },
      })),
    } as unknown as ReadPropertyInsightsDependencies['authorization'],
    processingProfiles: {
      readForAi: vi.fn(async () => ({
        status: 'available',
        profile: { profileVersion: 11, timezone: 'Asia/Tokyo' },
      })),
    } as unknown as ReadPropertyInsightsDependencies['processingProfiles'],
    aggregates: {
      readWindow,
    } as unknown as ReadPropertyInsightsDependencies['aggregates'],
    calendar: {
      resolveLocalDate,
    } as unknown as ReadPropertyInsightsDependencies['calendar'],
    reviewSources: {
      readTrendPopulation,
    } as unknown as ReadPropertyInsightsDependencies['reviewSources'],
    nowEpochMillis: () => NOW,
  })
  return { read, readWindow, readTrendPopulation }
}

const input = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  actorUserId: ACTOR_USER_ID,
  range: 30 as const,
}

describe('readPropertyInsights gates and windows', () => {
  it('keeps the review-analysis capability gate ahead of every data read', async () => {
    const { read, readWindow, readTrendPopulation } = harness({
      capabilities: ['property_trends'],
    })

    await expect(read(input)).resolves.toEqual({ status: 'disabled' })
    expect(readWindow).not.toHaveBeenCalled()
    expect(readTrendPopulation).not.toHaveBeenCalled()
  })

  it('uses an equal-length preceding window ending the day before the current one', async () => {
    const current = populationReview(1, '2026-08-20')
    const { read, readWindow, readTrendPopulation } = harness({
      population: { status: 'complete', reviews: [current] },
      aggregate: {
        head: {},
        days: [],
        analyzedReviews: [analyzedReview(1, '2026-08-20')],
        unavailableReviews: [],
      },
    })

    const result = await read(input)
    expect(result).toMatchObject({
      status: 'ready',
      range: 30,
      startLocalDate: '2026-07-22',
      endLocalDate: '2026-08-20',
      precedingPeriod: {
        startLocalDate: '2026-06-22',
        endLocalDate: '2026-07-21',
      },
    })
    expect(readWindow).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 7,
      reviewAnalysisEpoch: 4,
      propertyProfileVersion: 11,
      startLocalDate: '2026-06-22',
      endLocalDate: '2026-08-20',
    })
    expect(readTrendPopulation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        startLocalDate: '2026-06-22',
        endLocalDate: '2026-08-20',
      }),
    )
  })

  it('reports preparing instead of an absence when either fenced read is unsettled', async () => {
    const aggregateGap = harness({ aggregate: null })
    await expect(aggregateGap.read(input)).resolves.toEqual({ status: 'preparing' })

    const populationGap = harness({
      population: { status: 'policy_unavailable' },
    })
    await expect(populationGap.read(input)).resolves.toEqual({ status: 'preparing' })
  })
})

describe('readPropertyInsights evidence', () => {
  it('accounts for ready, star-only, unsupported-language, and awaiting Reviews', async () => {
    const reviews = [
      populationReview(1, '2026-08-20', { rating: 5 }),
      populationReview(2, '2026-08-19', { hasText: false, rating: 4 }),
      populationReview(3, '2026-08-18', { rating: 3 }),
      populationReview(4, '2026-08-17', { rating: 2 }),
    ]
    const { read } = harness({
      population: { status: 'complete', reviews },
      aggregate: {
        head: {},
        days: [],
        analyzedReviews: [analyzedReview(1, '2026-08-20', { rating: 5 })],
        unavailableReviews: [unavailableReview(3, '2026-08-18', 3)],
      },
    })

    const result = await read(input)
    if (result.status !== 'ready') throw new Error('expected ready insights')
    expect(result.basis).toEqual({
      reviewCount: 4,
      analyzedReviewCount: 1,
      currentAnalysisCount: 2,
      starOnlyCount: 1,
      notAnalyzableCount: 1,
      awaitingAnalysisCount: 1,
      ratingDistribution: [
        { stars: 1, count: 0 },
        { stars: 2, count: 1 },
        { stars: 3, count: 1 },
        { stars: 4, count: 1 },
        { stars: 5, count: 1 },
      ],
    })
  })

  it('aggregates fixed aspect-impact-v1 evidence at read time and compares periods', async () => {
    const reviews = [
      populationReview(1, '2026-08-20', { rating: 1 }),
      populationReview(2, '2026-08-19', { rating: 3 }),
      populationReview(3, '2026-08-18', { rating: 5 }),
      populationReview(4, '2026-07-21', { rating: 2 }),
    ]
    const analyzedReviews = [
      analyzedReview(1, '2026-08-20', {
        rating: 1,
        aspect: 'service',
        polarity: 'negative',
        intensity: -100,
        issueLabel: 'slow front desk',
      }),
      analyzedReview(2, '2026-08-19', {
        rating: 3,
        aspect: 'service',
        polarity: 'negative',
        intensity: -100,
        issueLabel: 'slow front desk',
      }),
      analyzedReview(3, '2026-08-18', {
        rating: 5,
        aspect: 'room',
        polarity: 'positive',
        intensity: 100,
        issueLabel: 'quiet rooms',
      }),
      analyzedReview(4, '2026-07-21', {
        rating: 2,
        aspect: 'service',
        polarity: 'negative',
        intensity: -50,
        issueLabel: 'slow front desk',
      }),
    ]
    const { read } = harness({
      population: { status: 'complete', reviews },
      aggregate: { head: {}, days: [], analyzedReviews, unavailableReviews: [] },
    })

    const result = await read(input)
    if (result.status !== 'ready') throw new Error('expected ready insights')
    expect(result.impactVersion).toBe('aspect-impact-v1')
    expect(result.aspects).toEqual([
      {
        aspect: 'service',
        polarity: 'negative',
        mentionCount: 2,
        impact: -1.6,
        comparison: {
          precedingMentionCount: 1,
          precedingImpact: -0.4,
          mentionCountDelta: 1,
          impactDelta: -1.2,
        },
      },
      {
        aspect: 'room',
        polarity: 'positive',
        mentionCount: 1,
        impact: 1,
        comparison: {
          precedingMentionCount: 0,
          precedingImpact: 0,
          mentionCountDelta: 1,
          impactDelta: 1,
        },
      },
    ])
    expect(result.emergingIssues).toEqual([
      {
        label: 'slow front desk',
        count: 2,
        comparison: { precedingCount: 1, delta: 1 },
      },
      {
        label: 'quiet rooms',
        count: 1,
        comparison: { precedingCount: 0, delta: 1 },
      },
    ])
    expect(result.weeklyAspectSeries.map(({ aspect }) => aspect)).toEqual([
      'service',
      'room',
    ])
  })

  it('bounds All Time at the earliest Review evidence and returns no comparisons', async () => {
    const reviews = [
      populationReview(1, '2025-06-25', { rating: 4 }),
      populationReview(2, '2025-10-02', { rating: 2 }),
    ]
    const { read, readWindow, readTrendPopulation } = harness({
      population: {
        status: 'complete',
        reviews,
        hasEvidenceBeforeStart: false,
      },
      aggregate: {
        head: {},
        days: [],
        analyzedReviews: [
          analyzedReview(1, '2025-06-25', {
            rating: 4,
            polarity: 'positive',
            issueLabel: 'helpful team',
          }),
          analyzedReview(2, '2025-10-02', {
            rating: 2,
            polarity: 'negative',
            issueLabel: 'slow front desk',
          }),
        ],
        unavailableReviews: [],
      },
    })

    const result = await read({ ...input, range: 'all' })

    expect(readTrendPopulation).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: PROPERTY_ID,
        startLocalDate: '2024-08-20',
        endLocalDate: '2026-08-20',
        detectEvidenceBeforeStart: true,
      }),
    )
    expect(readWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: PROPERTY_ID,
        startLocalDate: '2025-06-25',
        endLocalDate: '2026-08-20',
      }),
    )
    expect(result).toMatchObject({
      status: 'ready',
      range: 'all',
      startLocalDate: '2025-06-25',
      windowStartBasis: 'earliest_evidence',
    })
    expect(result).not.toHaveProperty('precedingPeriod')
    if (result.status !== 'ready' || result.range !== 'all') {
      throw new Error('expected ready All Time insights')
    }
    expect(result.aspects.every((aspect) => !('comparison' in aspect))).toBe(true)
    expect(result.emergingIssues.every((issue) => !('comparison' in issue))).toBe(true)
  })

  it('omits every comparison key from the All Time result contract', () => {
    type AllTimeReady = Extract<AiPropertyInsightsRead, { status: 'ready'; range: 'all' }>
    type DeclaresKey<Value, Key extends PropertyKey> = Key extends keyof Value
      ? true
      : false

    expectTypeOf<DeclaresKey<AllTimeReady, 'precedingPeriod'>>().toEqualTypeOf<false>()
    expectTypeOf<
      DeclaresKey<AllTimeReady['aspects'][number], 'comparison'>
    >().toEqualTypeOf<false>()
    expectTypeOf<
      DeclaresKey<AllTimeReady['emergingIssues'][number], 'comparison'>
    >().toEqualTypeOf<false>()
  })

  it('caps All Time at the derivative retention horizon when older evidence exists', async () => {
    const retained = populationReview(2, '2025-01-10', { rating: 5 })
    const { read, readWindow, readTrendPopulation } = harness({
      population: {
        status: 'complete',
        reviews: [retained],
        hasEvidenceBeforeStart: true,
      },
      aggregate: {
        head: {},
        days: [],
        analyzedReviews: [analyzedReview(2, '2025-01-10')],
        unavailableReviews: [],
      },
    })

    const result = await read({ ...input, range: 'all' })

    expect(readTrendPopulation).toHaveBeenCalledWith(
      expect.objectContaining({
        startLocalDate: '2024-08-20',
        detectEvidenceBeforeStart: true,
      }),
    )
    expect(readWindow).toHaveBeenCalledWith(
      expect.objectContaining({ startLocalDate: '2024-08-20' }),
    )
    expect(result).toMatchObject({
      status: 'ready',
      range: 'all',
      startLocalDate: '2024-08-20',
      windowStartBasis: 'derivative_retention_horizon',
    })
  })

  it('returns insufficient_data rather than a ready payload of zero figures', async () => {
    const { read } = harness({
      population: {
        status: 'complete',
        reviews: [populationReview(1, '2026-07-21', { rating: 5 })],
      },
      aggregate: {
        head: {},
        days: [],
        analyzedReviews: [analyzedReview(1, '2026-07-21')],
        unavailableReviews: [],
      },
    })

    await expect(read(input)).resolves.toEqual({
      status: 'insufficient_data',
      startLocalDate: '2026-07-22',
      endLocalDate: '2026-08-20',
    })
  })
})
