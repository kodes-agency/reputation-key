import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import {
  createReadPropertyAggregates,
  type ReadPropertyAggregatesDependencies,
} from './read-property-aggregates'

const ORG = organizationId('11111111-1111-4111-8111-111111111111')
const PROP = propertyId('22222222-2222-4222-8222-222222222222')
const ACTOR = userId('33333333-3333-4333-8333-333333333333')
const NOW = Date.UTC(2026, 7, 20, 3, 0, 0)

function day(
  localDate: string,
  over: Readonly<{
    reviewCount?: number
    positive?: number
    neutral?: number
    negative?: number
    mixed?: number
    aspectCounts?: readonly Readonly<{
      aspect: 'service' | 'cleanliness' | 'room'
      polarity: 'positive' | 'neutral' | 'negative'
      count: number
    }>[]
  }> = {},
) {
  return {
    localDate,
    reviewCount: over.reviewCount ?? 2,
    ratingSum: 8,
    sentimentCounts: {
      positive: over.positive ?? 1,
      neutral: over.neutral ?? 0,
      negative: over.negative ?? 1,
      mixed: over.mixed ?? 0,
    },
    aspectCounts: over.aspectCounts ?? [
      { aspect: 'service' as const, polarity: 'negative' as const, count: 1 },
      { aspect: 'cleanliness' as const, polarity: 'positive' as const, count: 1 },
    ],
    attentionCounts: { urgent: 0, high: 0, medium: 1, low: 1 },
  }
}

function analyzedReview(
  sequence: number,
  input: Readonly<{
    rating: number
    aspect: 'service' | 'cleanliness' | 'room'
    polarity: 'positive' | 'neutral' | 'negative'
    intensity: number
    issueLabel?: string | null
  }>,
) {
  return {
    reviewId: reviewId(`00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`),
    sourceRevision: 1,
    analysisSequence: sequence,
    localDate: '2026-08-20',
    rating: input.rating,
    sentiment:
      input.polarity === 'negative' ? ('negative' as const) : ('positive' as const),
    attention: 'low' as const,
    aspects: [
      {
        aspect: input.aspect,
        polarity: input.polarity,
        intensity: input.intensity,
      },
    ],
    issueLabel: input.issueLabel ?? null,
    analysisProfileVersion: 'review-analysis-v2',
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    modelSnapshot: 'gpt-5-mini-2025-08-07',
  }
}

function harness(
  over: Readonly<{
    capabilities?: readonly string[]
    state?: string
    localDate?: string | null
    window?: unknown
  }> = {},
) {
  const readWindow = vi.fn(async () =>
    over.window === undefined
      ? {
          head: {},
          days: [day('2026-08-19'), day('2026-08-20')],
          analyzedReviews: [],
        }
      : over.window,
  )
  const resolveLocalDate = vi.fn(async () =>
    over.localDate === undefined ? '2026-08-20' : over.localDate,
  )
  const read = createReadPropertyAggregates({
    authorization: {
      readMerchantAuthorization: vi.fn(async () => ({
        state: over.state ?? 'enabled',
        authorizationLineageId: 'lineage-1',
        capabilities: over.capabilities ?? ['review_analysis'],
        authorizedSourceEpoch: 7,
        capabilityEpochs: {
          review_analysis: { epoch: 4 },
          property_trends: { epoch: 9 },
        },
      })),
    } as unknown as ReadPropertyAggregatesDependencies['authorization'],
    processingProfiles: {
      readForAi: vi.fn(async () => ({
        status: 'available',
        profile: { profileVersion: 11, timezone: 'Asia/Tokyo' },
      })),
    } as unknown as ReadPropertyAggregatesDependencies['processingProfiles'],
    aggregates: {
      readWindow,
    } as unknown as ReadPropertyAggregatesDependencies['aggregates'],
    calendar: {
      resolveLocalDate,
    } as unknown as ReadPropertyAggregatesDependencies['calendar'],
    nowEpochMillis: () => NOW,
  })
  return { read, readWindow, resolveLocalDate }
}

const input = { organizationId: ORG, propertyId: PROP, actorUserId: ACTOR, days: 30 }

describe('readPropertyAggregates capability gate', () => {
  it('is disabled without the review_analysis capability', async () => {
    const { read, readWindow } = harness({ capabilities: ['property_trends'] })
    expect(await read(input)).toEqual({ status: 'disabled' })
    expect(readWindow).not.toHaveBeenCalled()
  })

  it('is disabled when the merchant authorization is not enabled', async () => {
    const { read, readWindow } = harness({ state: 'revoked' })
    expect(await read(input)).toEqual({ status: 'disabled' })
    expect(readWindow).not.toHaveBeenCalled()
  })
})

describe('readPropertyAggregates window', () => {
  it('pins every column of the aggregate primary key', async () => {
    const { read, readWindow } = harness()
    await read(input)
    expect(readWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEpoch: 7,
        reviewAnalysisEpoch: 4,
        propertyProfileVersion: 11,
      }),
    )
  })

  it('resolves the inclusive window in the property timezone', async () => {
    const { read, readWindow, resolveLocalDate } = harness()
    await read(input)
    expect(resolveLocalDate).toHaveBeenCalledWith({
      reviewedAtEpochMillis: NOW,
      timezone: 'Asia/Tokyo',
      calendarProfileVersion: 'property-calendar-v1',
    })
    expect(readWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        startLocalDate: '2026-07-22',
        endLocalDate: '2026-08-20',
      }),
    )
  })

  it('reports preparing rather than zeroes while aggregates are unsettled', async () => {
    const { read } = harness({ window: null })
    expect(await read(input)).toEqual({ status: 'preparing' })
  })

  it('reports preparing when the calendar cannot resolve a local date', async () => {
    const { read, readWindow } = harness({ localDate: null })
    expect(await read(input)).toEqual({ status: 'preparing' })
    expect(readWindow).not.toHaveBeenCalled()
  })
})

describe('readPropertyAggregates summary', () => {
  it('returns aspect-polarity counts and computes weighted impact at read time', async () => {
    const { read } = harness({
      window: {
        head: {},
        days: [
          day('2026-08-20', {
            reviewCount: 3,
            aspectCounts: [
              { aspect: 'service', polarity: 'negative', count: 2 },
              { aspect: 'room', polarity: 'positive', count: 1 },
            ],
          }),
        ],
        analyzedReviews: [
          analyzedReview(1, {
            rating: 1,
            aspect: 'service',
            polarity: 'negative',
            intensity: -100,
            issueLabel: 'slow front desk',
          }),
          analyzedReview(2, {
            rating: 3,
            aspect: 'service',
            polarity: 'negative',
            intensity: -100,
            issueLabel: 'slow front desk',
          }),
          analyzedReview(3, {
            rating: 5,
            aspect: 'room',
            polarity: 'positive',
            intensity: 100,
            issueLabel: 'quiet rooms',
          }),
        ],
      },
    })

    const result = await read(input)
    if (result.status !== 'ready') throw new Error('expected ready')
    expect(result.impactVersion).toBe('aspect-impact-v1')
    expect(result.aspects).toEqual([
      { aspect: 'service', polarity: 'negative', mentionCount: 2, impact: -1.6 },
      { aspect: 'room', polarity: 'positive', mentionCount: 1, impact: 1 },
    ])
    expect(result.emergingIssues).toEqual([
      { label: 'slow front desk', count: 2 },
      { label: 'quiet rooms', count: 1 },
    ])
  })

  it('breaks aspect count and issue ties by stable identity', async () => {
    const { read } = harness({
      window: {
        head: {},
        days: [
          day('2026-08-20', {
            aspectCounts: [
              { aspect: 'service', polarity: 'negative', count: 2 },
              { aspect: 'cleanliness', polarity: 'negative', count: 2 },
            ],
          }),
        ],
        analyzedReviews: [
          analyzedReview(1, {
            rating: 2,
            aspect: 'service',
            polarity: 'negative',
            intensity: -50,
            issueLabel: 'slow service',
          }),
          analyzedReview(2, {
            rating: 2,
            aspect: 'cleanliness',
            polarity: 'negative',
            intensity: -50,
            issueLabel: 'dirty bathroom',
          }),
        ],
      },
    })
    const result = await read(input)
    if (result.status !== 'ready') throw new Error('expected ready')
    expect(result.aspects.map(({ aspect }) => aspect)).toEqual(['cleanliness', 'service'])
    expect(result.emergingIssues.map(({ label }) => label)).toEqual([
      'dirty bathroom',
      'slow service',
    ])
  })

  it('keeps sentiment rows and excludes labels that fail the label rule', async () => {
    const { read } = harness({
      window: {
        head: {},
        days: [day('2026-08-19'), day('2026-08-20')],
        analyzedReviews: [
          analyzedReview(1, {
            rating: 1,
            aspect: 'service',
            polarity: 'negative',
            intensity: -80,
            issueLabel: 'Copied Review Excerpt',
          }),
        ],
      },
    })
    const result = await read(input)
    if (result.status !== 'ready') throw new Error('expected ready')
    expect(result.sentimentByDay.map(({ localDate }) => localDate)).toEqual([
      '2026-08-19',
      '2026-08-20',
    ])
    expect(result.emergingIssues).toEqual([])
  })
})
