import { describe, expect, it } from 'vitest'
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

const MS_PER_DAY = 86_400_000
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

const thirtyDayRange = {
  startDate: new Date(NOW.getTime() - 30 * MS_PER_DAY),
  endDate: NOW,
  timeRange: '30d' as const,
}
const evidence = {
  definitionVersionId: 'a0000000-0000-4000-8000-000000000099',
  periodStart: thirtyDayRange.startDate,
  periodEnd: thirtyDayRange.endDate,
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
  slaHours: 48,
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
    unanswered: 0,
    newFeedback: 0,
    escalated: 0,
    goalsBehindPace: 0,
    reviewEvidence: evidence,
    scanEvidence: evidence,
    feedbackEvidence: evidence,
    ...overrides,
  }
}

function projection(
  rows: readonly FleetOverviewProjectionRow[],
): FleetOverviewProjectionPort {
  const rated = rows.filter((item) => item.avgRating > 0)
  return {
    read: async () => ({
      rows,
      summary: {
        propertyCount: rows.length,
        totalAttention: rows.reduce(
          (sum, item) =>
            sum +
            item.unanswered +
            item.newFeedback +
            item.escalated +
            item.goalsBehindPace +
            (item.priorAvgRating > 0 && item.priorAvgRating - item.avgRating >= 0.3
              ? 1
              : 0),
          0,
        ),
        overallAvgRating:
          rated.length === 0
            ? 0
            : rated.reduce((sum, item) => sum + item.avgRating, 0) / rated.length,
      },
      nextAnchor: null,
    }),
  }
}

describe('getFleetOverview (use case)', () => {
  it('preserves the projection keyset order and fleet totals', async () => {
    const getFleet = getFleetOverview({
      projection: projection([
        row(PROP_B),
        row(PROP_A, { unanswered: 3, newFeedback: 1, goalsBehindPace: 1 }),
      ]),
      resolveAccessiblePropertyIds,
      clock: () => NOW,
    })

    const result = await getFleet(baseInput)

    expect(
      result.entries.map(({ name, totalAttention }) => ({ name, totalAttention })),
    ).toEqual([
      { name: 'Bravo', totalAttention: 0 },
      { name: 'Alpha', totalAttention: 5 },
    ])
    expect(result.totals).toEqual({
      propertyCount: 2,
      totalAttention: 5,
      overallAvgRating: 4.5,
    })
    expect(result.nextCursor).toBeNull()
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

  it('counts a rating drop when the current average fell by at least 0.3', async () => {
    const getFleet = getFleetOverview({
      projection: projection([row(PROP_A, { avgRating: 4, priorAvgRating: 4.4 })]),
      resolveAccessiblePropertyIds,
      clock: () => NOW,
    })

    const result = await getFleet(baseInput)

    expect(result.entries[0]).toMatchObject({
      avgRatingTrend: -9,
      attentionSignals: { ratingDrop: true },
      totalAttention: 1,
    })
    expect(result.totals.totalAttention).toBe(1)
  })

  it('does not infer an all-time trend or rating-drop attention signal', async () => {
    const getFleet = getFleetOverview({
      projection: projection([row(PROP_A, { avgRating: 4, priorAvgRating: 4.4 })]),
      resolveAccessiblePropertyIds,
      clock: () => NOW,
    })

    const result = await getFleet({
      ...baseInput,
      startDate: new Date(0),
      timeRange: 'all',
    })

    expect(result.entries[0]).toMatchObject({
      avgRatingTrend: null,
      attentionSignals: { ratingDrop: false },
      totalAttention: 0,
    })
  })

  it('excludes zero-rated properties from the overall average', async () => {
    const getFleet = getFleetOverview({
      projection: projection([
        row(PROP_A, { avgRating: 0, priorAvgRating: 0, reviewCount: 0 }),
        row(PROP_B, { avgRating: 0, priorAvgRating: 0, reviewCount: 0 }),
      ]),
      resolveAccessiblePropertyIds,
      clock: () => NOW,
    })

    const result = await getFleet(baseInput)

    expect(result.totals).toMatchObject({ propertyCount: 2, overallAvgRating: 0 })
    expect(result.entries.every((entry) => entry.avgRating === 0)).toBe(true)
  })
})
