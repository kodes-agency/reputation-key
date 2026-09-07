import { describe, expect, it, vi } from 'vitest'
import {
  decodeFleetCursor,
  encodeFleetCursor,
  getFleetOverview,
} from './get-fleet-overview'
import type {
  FleetOverviewProjectionPort,
  FleetOverviewProjectionRow,
} from '../ports/fleet-overview-projection.port'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { RATING_DROP_THRESHOLD } from '../utils'

const NOW = new Date('2025-06-15T12:00:00Z')
const ORG = organizationId('org-test')
type FleetProperty = Pick<
  FleetOverviewProjectionRow,
  'propertyId' | 'name' | 'slug' | 'timezone'
>
const scope = {
  userId: userId('fleet-manager'),
  organizationWide: true,
}
const resolveAccessiblePropertyIds = async () => null
const PROP_A: FleetProperty = {
  propertyId: propertyId('a0000000-0000-4000-8000-000000000001'),
  name: 'Alpha',
  slug: 'alpha',
  timezone: 'UTC',
}
const PROP_B: FleetProperty = {
  propertyId: propertyId('b0000000-0000-4000-8000-000000000001'),
  name: 'Bravo',
  slug: 'bravo',
  timezone: 'UTC',
}
const zeroInboxTargets = {
  getGoogleReviewTargetCountsByProperty: async (input: {
    propertyIds: readonly (typeof PROP_A.propertyId)[]
  }) => new Map(input.propertyIds.map((id) => [id, { activeCount: 0, overdueCount: 0 }])),
}

const thirtyDayRange = {
  timeRange: '30d' as const,
}
const evidence = {
  definitionVersionId: 'a0000000-0000-4000-8000-000000000099',
  periodStart: new Date('2025-05-16T12:00:00Z'),
  periodEnd: NOW,
  timezone: 'UTC',
  sourcePolicies: ['google_property_derivative'],
  watermark: NOW,
  freshness: 'fresh' as const,
  completeness: 1,
  correctionCount: 0,
}
const baseInput = {
  organizationId: ORG,
  scope,
  portalReadEnabled: true,
  goalReadEnabled: true,
  ...thirtyDayRange,
}

function row(
  property: FleetProperty,
  overrides: Partial<FleetOverviewProjectionRow> = {},
): FleetOverviewProjectionRow {
  return {
    ...property,
    reviewCount: 10,
    priorReviewCount: 10,
    avgRating: 4.5,
    priorAvgRating: 4.5,
    scanCount: 100,
    feedbackCount: 20,
    overdue: 0,
    itemsToTriage: 0,
    escalated: 0,
    goalsBehindPace: 0,
    needsAttention: 0,
    reviewEvidence: evidence,
    scanEvidence: evidence,
    feedbackEvidence: evidence,
    ...overrides,
  }
}

function projection(
  rows: readonly FleetOverviewProjectionRow[],
): FleetOverviewProjectionPort {
  const ratingSampleCount = rows.reduce((sum, item) => sum + item.reviewCount, 0)
  return {
    read: async () => ({
      rows,
      summary: {
        propertyCount: rows.length,
        ratingSampleCount,
        totalAttention: rows.reduce(
          (sum, item) =>
            sum +
            item.needsAttention +
            (item.reviewCount >= 10 &&
            item.priorReviewCount >= 10 &&
            item.avgRating !== null &&
            item.priorAvgRating !== null &&
            item.priorAvgRating - item.avgRating >= RATING_DROP_THRESHOLD
              ? 1
              : 0),
          0,
        ),
        overallAvgRating:
          ratingSampleCount === 0
            ? 0
            : rows.reduce(
                (sum, item) => sum + (item.avgRating ?? 0) * item.reviewCount,
                0,
              ) / ratingSampleCount,
      },
      nextAnchor: null,
    }),
  }
}

describe('getFleetOverview (use case)', () => {
  it('preserves the projection keyset order and fleet totals', async () => {
    const readTargets = vi.fn(async () => {
      return new Map([
        [PROP_B.propertyId, { activeCount: 0, overdueCount: 0 }],
        [PROP_A.propertyId, { activeCount: 3, overdueCount: 3 }],
      ])
    })
    const getFleet = getFleetOverview({
      projection: projection([
        row(PROP_B),
        row(PROP_A, {
          overdue: 0,
          itemsToTriage: 4,
          escalated: 2,
          goalsBehindPace: 1,
          needsAttention: 5,
        }),
      ]),
      resolveAccessiblePropertyIds,
      clock: () => NOW,
      inboxTargets: {
        getGoogleReviewTargetCountsByProperty: readTargets,
      },
    })

    const result = await getFleet(baseInput)

    expect(
      result.entries.map(({ name, totalAttention }) => ({ name, totalAttention })),
    ).toEqual([
      { name: 'Bravo', totalAttention: 0 },
      { name: 'Alpha', totalAttention: 5 },
    ])
    expect(result.entries[1]?.attentionSignals).toMatchObject({
      overdue: 3,
      itemsToTriage: 4,
      escalated: 2,
      goalsBehindPace: 1,
      needsAttention: 5,
    })
    expect(result.totals).toEqual({
      propertyCount: 2,
      totalAttention: 5,
      overallAvgRating: 4.5,
      ratingSampleCount: 20,
    })
    expect(result.nextCursor).toBeNull()
    expect(readTargets).toHaveBeenCalledOnce()
    expect(readTargets).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyIds: [PROP_B.propertyId, PROP_A.propertyId],
      now: NOW,
    })
  })
  it('round-trips opaque keyset cursors and rejects malformed cursors', () => {
    const anchor = { lowerName: 'alpha', propertyId: PROP_A.propertyId }

    expect(decodeFleetCursor(encodeFleetCursor(anchor))).toEqual(anchor)

    let caught: unknown
    try {
      decodeFleetCursor('not-a-fleet-cursor')
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({
      _tag: 'DashboardError',
      code: 'invalid_input',
      message: 'Invalid fleet cursor',
    })
  })

  it('reports an absolute rating delta and flags a sufficiently-supported drop', async () => {
    const getFleet = getFleetOverview({
      projection: projection([row(PROP_A, { avgRating: 4, priorAvgRating: 4.4 })]),
      resolveAccessiblePropertyIds,
      clock: () => NOW,
      inboxTargets: zeroInboxTargets,
    })

    const result = await getFleet(baseInput)

    expect(result.entries[0]).toMatchObject({
      avgRatingComparison: -0.4,
      attentionSignals: { ratingDrop: true },
      totalAttention: 1,
    })
    expect(result.totals.totalAttention).toBe(1)
  })

  it('withholds a rating comparison and drop below the ten-rating floor', async () => {
    const getFleet = getFleetOverview({
      projection: projection([
        row(PROP_A, {
          avgRating: 4,
          priorAvgRating: 4.4,
          reviewCount: 9,
          priorReviewCount: 10,
        }),
      ]),
      resolveAccessiblePropertyIds,
      clock: () => NOW,
      inboxTargets: zeroInboxTargets,
    })

    const result = await getFleet(baseInput)

    expect(result.entries[0]).toMatchObject({
      avgRatingComparison: null,
      attentionSignals: { ratingDrop: false },
      totalAttention: 0,
    })
  })

  it('does not infer an all-time trend or rating-drop attention signal', async () => {
    const getFleet = getFleetOverview({
      projection: projection([row(PROP_A, { avgRating: 4, priorAvgRating: 4.4 })]),
      resolveAccessiblePropertyIds,
      clock: () => NOW,
      inboxTargets: zeroInboxTargets,
    })

    const result = await getFleet({
      ...baseInput,
      timeRange: 'all',
    })

    expect(result.entries[0]).toMatchObject({
      avgRatingComparison: null,
      attentionSignals: { ratingDrop: false },
      totalAttention: 0,
    })
  })

  it('keeps properties without reviews null while excluding them from the average', async () => {
    const getFleet = getFleetOverview({
      projection: projection([
        row(PROP_A, { avgRating: null, priorAvgRating: null, reviewCount: 0 }),
        row(PROP_B, { avgRating: null, priorAvgRating: null, reviewCount: 0 }),
      ]),
      resolveAccessiblePropertyIds,
      clock: () => NOW,
      inboxTargets: zeroInboxTargets,
    })

    const result = await getFleet(baseInput)

    expect(result.totals).toMatchObject({
      propertyCount: 2,
      overallAvgRating: 0,
      ratingSampleCount: 0,
    })
    expect(result.entries.every((entry) => entry.avgRating === null)).toBe(true)
  })
})
