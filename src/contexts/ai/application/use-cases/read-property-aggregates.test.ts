// The dashboard aggregate read. Three things here are easy to get wrong and
// invisible if wrong: the capability gate, the epoch triple, and the
// property-local window. Each gets a test that fails if it is dropped.
import { describe, it, expect, vi } from 'vitest'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createReadPropertyAggregates } from './read-property-aggregates'

const ORG = organizationId('11111111-1111-4111-8111-111111111111')
const PROP = propertyId('22222222-2222-4222-8222-222222222222')
const ACTOR = userId('33333333-3333-4333-8333-333333333333')
const NOW = Date.UTC(2026, 7, 20, 3, 0, 0)

function day(localDate: string, over: Partial<Record<string, number>> = {}) {
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
    categoryCounts: {
      service: over.service ?? 1,
      staff: 0,
      quality: 0,
      value: 0,
      cleanliness: over.cleanliness ?? 1,
      wait_time: 0,
      atmosphere: 0,
      location: 0,
      accessibility: 0,
      other: 0,
    },
    attentionCounts: { urgent: 0, high: 0, medium: 1, low: 1 },
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
      ? { head: {}, days: [day('2026-08-19'), day('2026-08-20')] }
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    processingProfiles: {
      readForAi: vi.fn(async () => ({
        status: 'available',
        profile: { profileVersion: 11, timezone: 'Asia/Tokyo' },
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    aggregates: { readWindow } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    calendar: { resolveLocalDate } as any,
    nowEpochMillis: () => NOW,
  })
  return { read, readWindow, resolveLocalDate }
}

const input = { organizationId: ORG, propertyId: PROP, actorUserId: ACTOR, days: 30 }

describe('readPropertyAggregates capability gate', () => {
  it('is disabled without the review_analysis capability', async () => {
    // Category and sentiment are analysis derivatives. Holding property_trends
    // must not unlock them.
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
    // The grain is one row per property per local date PER EPOCH TRIPLE. A read
    // filtered on dates alone sums the same day across successive epochs and
    // reports inflated counts.
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

  it('resolves the window in the property timezone, not UTC', async () => {
    const { read, readWindow, resolveLocalDate } = harness()
    await read(input)
    expect(resolveLocalDate).toHaveBeenCalledWith({
      reviewedAtEpochMillis: NOW,
      timezone: 'Asia/Tokyo',
      calendarProfileVersion: 'property-calendar-v1',
    })
    // 30 days inclusive of today, so the start is today minus 29.
    expect(readWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        startLocalDate: '2026-07-22',
        endLocalDate: '2026-08-20',
      }),
    )
  })

  it('reports preparing rather than zeroes while the aggregate is mid-flight', async () => {
    // readWindow returns null when the heads and the cursor disagree. Zeroes
    // would read as "no reviews" instead of "not settled yet".
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
  it('sums the window and sorts categories by volume', async () => {
    const { read } = harness({
      window: {
        head: {},
        days: [
          day('2026-08-19', { service: 1, cleanliness: 3 }),
          day('2026-08-20', { service: 1, cleanliness: 4 }),
        ],
      },
    })
    const result = await read(input)
    if (result.status !== 'ready') throw new Error('expected ready')
    expect(result.reviewCount).toBe(4)
    // Cleanliness outweighs service, so it must lead: the section answers
    // "what should I fix?".
    expect(result.categories.slice(0, 2)).toEqual([
      { category: 'cleanliness', count: 7 },
      { category: 'service', count: 2 },
    ])
    expect(result.sentimentTotals).toEqual({
      positive: 2,
      neutral: 0,
      negative: 2,
      mixed: 0,
    })
  })

  it('breaks ties by name so the order never flickers between reads', async () => {
    const { read } = harness({
      window: { head: {}, days: [day('2026-08-20', { service: 2, cleanliness: 2 })] },
    })
    const result = await read(input)
    if (result.status !== 'ready') throw new Error('expected ready')
    const tied = result.categories.filter((entry) => entry.count === 2)
    expect(tied.map((entry) => entry.category)).toEqual(['cleanliness', 'service'])
  })

  it('keeps one entry per day so sentiment can be drawn as a trend', async () => {
    const { read } = harness()
    const result = await read(input)
    if (result.status !== 'ready') throw new Error('expected ready')
    expect(result.sentimentByDay.map((entry) => entry.localDate)).toEqual([
      '2026-08-19',
      '2026-08-20',
    ])
  })
})
