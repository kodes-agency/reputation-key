import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
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
const ADMIN = buildTestAuthContext({
  organizationId: ORGANIZATION_ID,
  userId: userId('33333333-3333-4333-8333-333333333333'),
  role: 'AccountAdmin',
})
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

function preAspectAnalyzedReview(
  sequence: number,
  localDate: string,
  rating: number,
): AiPropertyAnalyzedReview {
  return Object.freeze({
    ...analyzedReview(sequence, localDate, { rating }),
    aspects: Object.freeze([]),
    analysisProfileVersion: 'review-analysis-v1',
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
    /** The Properties a PropertyManager reader is granted. */
    grants?: readonly (typeof PROPERTY_ID)[]
  }> = {},
) {
  const readWindow = vi.fn(async () => {
    const aggregate =
      options.aggregate === undefined
        ? {
            head: {},
            days: [],
            analyzedReviews: [],
            unavailableReviews: [],
          }
        : options.aggregate
    if (aggregate === null || typeof aggregate !== 'object') return aggregate
    return {
      coverage: {
        settledAnalysisCount: 1,
        expectedAnalysisCount: 1,
        awaitingAnalysisCount: 0,
      },
      ...aggregate,
    }
  })
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
  const readMerchantAuthorization = vi.fn(async () => ({
    state: 'enabled',
    authorizationLineageId: 'lineage-1',
    capabilities: options.capabilities ?? ['review_analysis'],
    authorizedSourceEpoch: 7,
    capabilityEpochs: {
      review_analysis: { epoch: 4 },
      property_trends: { epoch: 9 },
    },
  }))
  const read = createReadPropertyInsights({
    propertyAccess: async () => options.grants ?? [],
    authorization: {
      readMerchantAuthorization,
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
  return { read, readWindow, readTrendPopulation, readMerchantAuthorization }
}

const input = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  actor: ADMIN,
  range: 30 as const,
}

describe('readPropertyInsights authorization', () => {
  const OTHER_PROPERTY_ID = propertyId('22222222-2222-4222-8222-222222222223')
  const manager = buildTestAuthContext({
    organizationId: ORGANIZATION_ID,
    role: 'PropertyManager',
  })
  const forbidden = { _tag: 'AiError', code: 'forbidden' }

  it('refuses a manager with no grant on the Property before any AI state is read', async () => {
    const { read, readWindow, readTrendPopulation, readMerchantAuthorization } = harness({
      grants: [OTHER_PROPERTY_ID],
    })

    await expect(read({ ...input, actor: manager })).rejects.toMatchObject(forbidden)
    expect(readMerchantAuthorization).not.toHaveBeenCalled()
    expect(readWindow).not.toHaveBeenCalled()
    expect(readTrendPopulation).not.toHaveBeenCalled()
  })

  it('refuses the all-time report the same way', async () => {
    const { read, readTrendPopulation } = harness({ grants: [OTHER_PROPERTY_ID] })

    await expect(read({ ...input, actor: manager, range: 'all' })).rejects.toMatchObject(
      forbidden,
    )
    expect(readTrendPopulation).not.toHaveBeenCalled()
  })

  it('refuses a reader who belongs to another Organization', async () => {
    const { read, readWindow } = harness()
    const foreignAdmin = buildTestAuthContext({
      organizationId: organizationId('11111111-1111-4111-8111-111111111112'),
      role: 'AccountAdmin',
    })

    await expect(read({ ...input, actor: foreignAdmin })).rejects.toMatchObject(forbidden)
    expect(readWindow).not.toHaveBeenCalled()
  })

  it('lets a manager granted the Property through to the AI gate', async () => {
    const { read, readMerchantAuthorization } = harness({
      grants: [PROPERTY_ID],
      capabilities: ['property_trends'],
    })

    await expect(read({ ...input, actor: manager })).resolves.toEqual({
      status: 'disabled',
    })
    expect(readMerchantAuthorization).toHaveBeenCalledTimes(1)
  })
})

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

  it('keeps preparing when no aggregate evidence has been applied', async () => {
    const noAnalysis = harness({
      aggregate: {
        head: {},
        coverage: {
          settledAnalysisCount: 0,
          expectedAnalysisCount: 1,
          awaitingAnalysisCount: 1,
        },
        days: [],
        analyzedReviews: [],
      },
      population: {
        status: 'complete',
        reviews: [populationReview(1, '2026-08-20')],
        hasEvidenceBeforeStart: false,
      },
    })
    await expect(noAnalysis.read(input)).resolves.toEqual({ status: 'preparing' })
  })

  it('keeps preparing when the Review population cannot be read safely', async () => {
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
      preAspectAnalysisCount: 0,
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

  it('returns provisional partial evidence without period comparisons', async () => {
    const reviews = [
      populationReview(1, '2026-08-20', { rating: 5 }),
      populationReview(2, '2026-08-19', { rating: 2 }),
      populationReview(3, '2026-07-21', { rating: 4 }),
    ]
    const { read } = harness({
      population: { status: 'complete', reviews },
      aggregate: {
        head: {},
        coverage: {
          settledAnalysisCount: 2,
          expectedAnalysisCount: 3,
          awaitingAnalysisCount: 1,
        },
        days: [],
        analyzedReviews: [
          analyzedReview(1, '2026-08-20', {
            rating: 5,
            aspect: 'service',
            issueLabel: 'helpful team',
          }),
          analyzedReview(3, '2026-07-21', {
            rating: 4,
            aspect: 'room',
            issueLabel: 'quiet rooms',
          }),
        ],
        unavailableReviews: [],
      },
    })

    const result = await read(input)

    expect(result).toMatchObject({
      status: 'ready',
      provisional: true,
      coverage: {
        settledAnalysisCount: 2,
        expectedAnalysisCount: 3,
        awaitingAnalysisCount: 1,
      },
      basis: { awaitingAnalysisCount: 1 },
    })
    expect(result).not.toHaveProperty('precedingPeriod')
    if (result.status !== 'ready') throw new Error('expected provisional insights')
    expect(result.aspects).toEqual([
      {
        aspect: 'service',
        polarity: 'positive',
        mentionCount: 1,
        reviewCount: 1,
        topicReviewCount: 1,
        ratingCounts: [0, 0, 0, 0, 1],
        // A single review is too few to weigh against the rest.
        stars: { mentionedAverage: 5, othersAverage: 2, gap: -3, upTo: null },
        change: 'unknown',
      },
    ])
    // One review naming an issue is an anecdote, not a recurring issue.
    expect(result.emergingIssues).toEqual([])
  })

  it('suppresses comparisons when the preceding window is still awaiting analysis', async () => {
    const current = populationReview(1, '2026-08-20')
    const preceding = populationReview(2, '2026-07-21')
    const { read } = harness({
      population: {
        status: 'complete',
        reviews: [current, preceding],
        hasEvidenceBeforeStart: false,
      },
      aggregate: {
        head: {},
        coverage: {
          settledAnalysisCount: 1,
          expectedAnalysisCount: 2,
          awaitingAnalysisCount: 1,
        },
        days: [],
        analyzedReviews: [analyzedReview(1, '2026-08-20')],
        unavailableReviews: [],
      },
    })

    const result = await read(input)

    expect(result).toMatchObject({ status: 'ready', provisional: true })
    expect(result).not.toHaveProperty('precedingPeriod')
    if (result.status !== 'ready') throw new Error('expected provisional insights')
    expect(result.aspects[0]).not.toHaveProperty('comparison')
  })

  it('separates v1 evidence and marks an aspect-only gap as predating analysis', async () => {
    const review = populationReview(1, '2026-08-20', { rating: 5 })
    const { read } = harness({
      population: { status: 'complete', reviews: [review] },
      aggregate: {
        head: {},
        days: [],
        analyzedReviews: [preAspectAnalyzedReview(1, '2026-08-20', 5)],
        unavailableReviews: [],
      },
    })

    const result = await read(input)
    if (result.status !== 'ready') throw new Error('expected ready insights')
    expect(result.basis).toEqual({
      reviewCount: 1,
      analyzedReviewCount: 0,
      preAspectAnalysisCount: 1,
      currentAnalysisCount: 1,
      starOnlyCount: 0,
      notAnalyzableCount: 0,
      awaitingAnalysisCount: 0,
      ratingDistribution: [
        { stars: 1, count: 0 },
        { stars: 2, count: 0 },
        { stars: 3, count: 0 },
        { stars: 4, count: 0 },
        { stars: 5, count: 1 },
      ],
    })
    expect(result.aspectEvidenceState).toBe('predates_aspect_analysis')
    expect(result.aspects).toEqual([])
  })

  it('counts reviews at read time, compares periods and keeps only recurring issues', async () => {
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
    expect(result).not.toHaveProperty('impactVersion')
    expect(result.provisional).toBe(false)
    expect(result.coverage).toEqual({
      settledAnalysisCount: 1,
      expectedAnalysisCount: 1,
      awaitingAnalysisCount: 0,
    })
    expect(result.aspects).toEqual([
      {
        aspect: 'service',
        polarity: 'negative',
        mentionCount: 2,
        reviewCount: 2,
        topicReviewCount: 2,
        ratingCounts: [1, 0, 1, 0, 0],
        // Two reviews rated 1 and 3 stars against one 5-star review: the share
        // is too small to weigh (three reviews are the least).
        stars: { mentionedAverage: 2, othersAverage: 5, gap: 3, upTo: null },
        // Three text reviews: far too few to say a share moved.
        change: 'unknown',
        comparison: { precedingMentionCount: 1, precedingReviewCount: 1 },
      },
      {
        aspect: 'room',
        polarity: 'positive',
        mentionCount: 1,
        reviewCount: 1,
        topicReviewCount: 1,
        ratingCounts: [0, 0, 0, 0, 1],
        stars: { mentionedAverage: 5, othersAverage: 2, gap: -3, upTo: null },
        change: 'unknown',
        comparison: { precedingMentionCount: 0, precedingReviewCount: 0 },
      },
    ])
    // 'quiet rooms' is named by one review: not recurring. 'slow front desk' is
    // named by two in the window (the third is in the period before).
    expect(result.emergingIssues).toEqual([{ label: 'slow front desk', count: 2 }])
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

  it('omits comparison keys from provisional presets and requires them when complete', () => {
    type ProvisionalPreset = Extract<
      AiPropertyInsightsRead,
      { status: 'ready'; provisional: true }
    >
    type CompletePreset = Extract<
      AiPropertyInsightsRead,
      { status: 'ready'; provisional: false }
    >
    type DeclaresKey<Value, Key extends PropertyKey> = Key extends keyof Value
      ? true
      : false

    expectTypeOf<
      DeclaresKey<ProvisionalPreset, 'precedingPeriod'>
    >().toEqualTypeOf<false>()
    expectTypeOf<
      DeclaresKey<ProvisionalPreset['aspects'][number], 'comparison'>
    >().toEqualTypeOf<false>()
    expectTypeOf<
      DeclaresKey<ProvisionalPreset['emergingIssues'][number], 'comparison'>
    >().toEqualTypeOf<false>()
    expectTypeOf<DeclaresKey<CompletePreset, 'precedingPeriod'>>().toEqualTypeOf<true>()
    expectTypeOf<
      DeclaresKey<CompletePreset['aspects'][number], 'comparison'>
    >().toEqualTypeOf<true>()
    // Issues carry no comparison in either: a recurring issue is a count in the window.
    expectTypeOf<
      DeclaresKey<CompletePreset['emergingIssues'][number], 'comparison'>
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

type Mention = Readonly<{
  aspect: 'service' | 'room' | 'cleanliness'
  polarity: 'positive' | 'neutral' | 'negative'
}>

/** An analysis that names several topics, or the same one twice. */
function analyzedNaming(
  sequence: number,
  localDate: string,
  rating: number,
  mentions: readonly Mention[],
): AiPropertyAnalyzedReview {
  return Object.freeze({
    ...analyzedReview(sequence, localDate, { rating }),
    aspects: Object.freeze(
      mentions.map((mention) => Object.freeze({ ...mention, intensity: 100 })),
    ),
  })
}

function readyAspects(result: AiPropertyInsightsRead) {
  if (result.status !== 'ready') throw new Error('expected ready insights')
  return result.aspects
}

describe('readPropertyInsights topics counted in reviews', () => {
  // Window 2026-07-22..2026-08-20. Three reviews complain about service, one of
  // them twice; one praises a room; one gave only stars.
  const reviews = [
    populationReview(1, '2026-08-20', { rating: 1 }),
    populationReview(2, '2026-08-19', { rating: 2 }),
    populationReview(3, '2026-08-18', { rating: 1 }),
    populationReview(4, '2026-08-17', { rating: 5 }),
    populationReview(5, '2026-08-16', { rating: 5, hasText: false }),
  ]
  const analyzedReviews = [
    analyzedNaming(1, '2026-08-20', 1, [
      { aspect: 'service', polarity: 'negative' },
      { aspect: 'service', polarity: 'negative' },
    ]),
    analyzedNaming(2, '2026-08-19', 2, [{ aspect: 'service', polarity: 'negative' }]),
    analyzedNaming(3, '2026-08-18', 1, [{ aspect: 'service', polarity: 'negative' }]),
    analyzedNaming(4, '2026-08-17', 5, [
      { aspect: 'room', polarity: 'positive' },
      { aspect: 'service', polarity: 'positive' },
    ]),
  ]

  async function readWindowRows() {
    const { read } = harness({
      population: { status: 'complete', reviews },
      aggregate: { head: {}, days: [], analyzedReviews, unavailableReviews: [] },
    })
    return readyAspects(await read(input))
  }

  it('counts a review once however many times it names the topic', async () => {
    const complaints = (await readWindowRows()).find(
      (row) => row.aspect === 'service' && row.polarity === 'negative',
    )

    expect(complaints).toMatchObject({
      mentionCount: 4,
      reviewCount: 3,
      ratingCounts: [2, 1, 0, 0, 0],
    })
  })

  it('counts the reviews that name a topic in any way once, praise and complaint together', async () => {
    const rows = await readWindowRows()

    // Review 4 praises service and reviews 1-3 complain about it: four reviews,
    // not the sum of the two rows' counts of one more review each.
    expect(
      rows.filter((row) => row.aspect === 'service').map((row) => row.topicReviewCount),
    ).toEqual([4, 4])
    expect(rows.find((row) => row.aspect === 'room')?.topicReviewCount).toBe(1)
  })

  it('sets the stars of the complaining reviews against every other review, star-only included', async () => {
    const complaints = (await readWindowRows()).find(
      (row) => row.aspect === 'service' && row.polarity === 'negative',
    )

    // Complaints: 1, 2 and 1 stars. The rest of the window: the 5-star review that
    // praised service and the 5-star review with no text, so 5 stars.
    expect(complaints?.stars.mentionedAverage).toBeCloseTo(4 / 3, 10)
    expect(complaints?.stars.othersAverage).toBe(5)
    // 3 of the window's 5 reviews, each 3.67 stars below the rest: 2.2 stars.
    expect(complaints?.stars.upTo).toBe(2.2)
  })

  it('has no change to report where no period was compared', async () => {
    const { read } = harness({
      population: { status: 'complete', reviews, hasEvidenceBeforeStart: false },
      aggregate: { head: {}, days: [], analyzedReviews, unavailableReviews: [] },
    })

    const result = await read({ ...input, range: 'all' })
    if (result.status !== 'ready') throw new Error('expected ready insights')
    expect(result.aspects.every((row) => row.change === 'unknown')).toBe(true)
  })

  it('says a share rose or fell only against the period before, with the evidence for it', async () => {
    // 20 reviews in the window, 12 complain about the room; 30 in the period
    // before, 3 complained. Praise went the other way.
    const current = Array.from({ length: 20 }, (_, index) => ({
      population: populationReview(index + 1, '2026-08-10', {
        rating: index < 12 ? 2 : 5,
      }),
      analyzed: analyzedNaming(index + 1, '2026-08-10', index < 12 ? 2 : 5, [
        { aspect: 'room', polarity: index < 12 ? 'negative' : 'positive' },
      ]),
    }))
    const before = Array.from({ length: 30 }, (_, index) => ({
      population: populationReview(100 + index, '2026-07-10', {
        rating: index < 3 ? 2 : 5,
      }),
      analyzed: analyzedNaming(100 + index, '2026-07-10', index < 3 ? 2 : 5, [
        { aspect: 'room', polarity: index < 3 ? 'negative' : 'positive' },
      ]),
    }))
    const { read } = harness({
      population: {
        status: 'complete',
        reviews: [...current, ...before].map((entry) => entry.population),
      },
      aggregate: {
        head: {},
        days: [],
        analyzedReviews: [...current, ...before].map((entry) => entry.analyzed),
        unavailableReviews: [],
      },
    })

    const rows = readyAspects(await read(input))

    expect(rows.find((row) => row.polarity === 'negative')).toMatchObject({
      reviewCount: 12,
      change: 'rising',
      comparison: { precedingReviewCount: 3 },
    })
    expect(rows.find((row) => row.polarity === 'positive')).toMatchObject({
      reviewCount: 8,
      change: 'falling',
      comparison: { precedingReviewCount: 27 },
    })
  })
})

describe('readPropertyInsights window', () => {
  // The window is 2026-07-22..2026-08-20 for 30 days; 365 days start 2025-08-21.
  function textReviews(count: number, localDate: string, firstSequence: number) {
    return Array.from({ length: count }, (_, index) => ({
      population: populationReview(firstSequence + index, localDate),
      analyzed: analyzedReview(firstSequence + index, localDate),
    }))
  }

  function harnessFor(entries: ReturnType<typeof textReviews>) {
    return harness({
      population: {
        status: 'complete',
        reviews: entries.map((entry) => entry.population),
      },
      aggregate: {
        head: {},
        days: [],
        analyzedReviews: entries.map((entry) => entry.analyzed),
        unavailableReviews: [],
      },
    })
  }

  it('reports the window a chosen range holds, and that the reader chose it', async () => {
    const { read } = harnessFor(textReviews(12, '2026-08-10', 1))

    const result = await read({ ...input, range: 90 })

    expect(result).toMatchObject({
      status: 'ready',
      range: 90,
      window: { selection: 'chosen', textReviewCount: 12 },
    })
  })

  it('does not count reviews with only stars as reviews with text', async () => {
    const reviews = [
      populationReview(1, '2026-08-10'),
      populationReview(2, '2026-08-10', { hasText: false }),
      populationReview(3, '2026-08-10', { hasText: false }),
    ]
    const { read } = harness({
      population: { status: 'complete', reviews },
      aggregate: {
        head: {},
        days: [],
        analyzedReviews: [analyzedReview(1, '2026-08-10')],
        unavailableReviews: [],
      },
    })

    expect(await read(input)).toMatchObject({ window: { textReviewCount: 1 } })
  })

  it('reads a year of reviews and the year before it for 12 months', async () => {
    const { read, readTrendPopulation, readWindow } = harnessFor(
      textReviews(4, '2026-02-10', 1),
    )

    const result = await read({ ...input, range: 365 })

    expect(result).toMatchObject({
      status: 'ready',
      range: 365,
      startLocalDate: '2025-08-21',
      endLocalDate: '2026-08-20',
      precedingPeriod: { startLocalDate: '2024-08-21', endLocalDate: '2025-08-20' },
    })
    expect(readTrendPopulation).toHaveBeenCalledWith(
      expect.objectContaining({ startLocalDate: '2024-08-21' }),
    )
    expect(readWindow).toHaveBeenCalledWith(
      expect.objectContaining({ startLocalDate: '2024-08-21' }),
    )
  })

  describe('automatic', () => {
    const auto = { ...input, range: 'auto' as const }

    it('picks 30 days for a property with 60 reviews with text in the last month', async () => {
      const { read, readTrendPopulation } = harnessFor(textReviews(60, '2026-08-10', 1))

      const result = await read(auto)

      expect(result).toMatchObject({
        status: 'ready',
        range: 30,
        window: { selection: 'automatic', textReviewCount: 60, enoughForPatterns: true },
      })
      // 12 months to count in, then the window it picked and the one before it.
      expect(readTrendPopulation).toHaveBeenCalledTimes(2)
      expect(readTrendPopulation).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          startLocalDate: '2025-08-21',
          endLocalDate: '2026-08-20',
        }),
      )
      expect(readTrendPopulation).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ startLocalDate: '2026-06-22' }),
      )
    })

    it('widens to 90 days when the last 30 days hold too few', async () => {
      const { read } = harnessFor([
        ...textReviews(20, '2026-08-10', 1),
        ...textReviews(40, '2026-06-25', 100),
      ])

      expect(await read(auto)).toMatchObject({
        range: 90,
        window: { selection: 'automatic', textReviewCount: 60, enoughForPatterns: true },
      })
    })

    it('widens to 6 months, then to 12 months', async () => {
      const sixMonths = harnessFor([
        ...textReviews(10, '2026-08-10', 1),
        ...textReviews(10, '2026-06-01', 100),
        ...textReviews(40, '2026-03-01', 200),
      ])
      expect(await sixMonths.read(auto)).toMatchObject({ range: 180 })

      const year = harnessFor([
        ...textReviews(10, '2026-08-10', 1),
        ...textReviews(10, '2026-06-01', 100),
        ...textReviews(10, '2026-03-01', 200),
        ...textReviews(40, '2025-11-01', 300),
      ])
      expect(await year.read(auto)).toMatchObject({
        range: 365,
        window: { selection: 'automatic', textReviewCount: 70, enoughForPatterns: true },
      })
    })

    it('settles on 12 months for a small property and counts only what it holds', async () => {
      // About three reviews with text a month: no shorter window reaches 60.
      const { read } = harnessFor([
        ...textReviews(3, '2026-08-10', 1),
        ...textReviews(3, '2026-07-01', 100),
        ...textReviews(30, '2026-01-15', 200),
      ])

      expect(await read(auto)).toMatchObject({
        range: 365,
        window: { selection: 'automatic', textReviewCount: 36, enoughForPatterns: true },
      })
    })

    it('says there are too few reviews with text to spot patterns under ten in a year', async () => {
      const { read } = harnessFor(textReviews(6, '2026-05-10', 1))

      expect(await read(auto)).toMatchObject({
        range: 365,
        window: { selection: 'automatic', textReviewCount: 6, enoughForPatterns: false },
      })
    })

    it('counts reviews with text only: a hundred star ratings do not choose the window', async () => {
      const stars = Array.from({ length: 100 }, (_, index) =>
        populationReview(500 + index, '2026-08-10', { hasText: false }),
      )
      const text = textReviews(5, '2026-08-10', 1)
      const { read } = harness({
        population: {
          status: 'complete',
          reviews: [...text.map((entry) => entry.population), ...stars],
        },
        aggregate: {
          head: {},
          days: [],
          analyzedReviews: text.map((entry) => entry.analyzed),
          unavailableReviews: [],
        },
      })

      expect(await read(auto)).toMatchObject({
        range: 365,
        window: { enoughForPatterns: false, textReviewCount: 5 },
      })
    })

    it('keeps preparing when the year of reviews cannot be read', async () => {
      const { read } = harness({ population: { status: 'limit_exceeded' } })

      await expect(read(auto)).resolves.toEqual({ status: 'preparing' })
    })

    it('says there is not enough when the year holds no review at all', async () => {
      const { read } = harnessFor([])

      await expect(read(auto)).resolves.toEqual({
        status: 'insufficient_data',
        startLocalDate: '2025-08-21',
        endLocalDate: '2026-08-20',
      })
    })

    it('is refused for a reader without the Property like any other range', async () => {
      const OTHER = propertyId('22222222-2222-4222-8222-222222222223')
      const manager = buildTestAuthContext({
        organizationId: ORGANIZATION_ID,
        role: 'PropertyManager',
      })
      const { read, readTrendPopulation } = harness({ grants: [OTHER] })

      await expect(read({ ...auto, actor: manager })).rejects.toMatchObject({
        code: 'forbidden',
      })
      expect(readTrendPopulation).not.toHaveBeenCalled()
    })
  })

  it('refuses a range it does not know', async () => {
    const { read } = harness()

    await expect(
      read({ ...input, range: 7 as unknown as typeof input.range }),
    ).rejects.toThrow('Property insights range must be auto, 30, 90, 180, 365, or all')
  })
})
