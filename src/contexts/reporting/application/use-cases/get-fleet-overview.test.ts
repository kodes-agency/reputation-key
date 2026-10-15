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
import { MIN_RATING_COMPARISON_SAMPLE } from '../../domain/portal-results-thresholds'

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
    google: null,
    lifecycleActive: true,
    ratingGoal: null,
    ...overrides,
  }
}

const GOOGLE_VERIFIED = new Date('2025-06-15T09:00:00Z')
const google = (
  overrides: Partial<NonNullable<FleetOverviewProjectionRow['google']>> = {},
) => ({
  reviewCount: 812,
  averageRating: 4.300000190734863,
  verifiedAt: GOOGLE_VERIFIED,
  bindingActive: true,
  ...overrides,
})

function fleetOf(rows: readonly FleetOverviewProjectionRow[]) {
  return getFleetOverview({
    projection: projection(rows),
    resolveAccessiblePropertyIds,
    clock: () => NOW,
    inboxTargets: zeroInboxTargets,
  })
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
            (item.reviewCount >= MIN_RATING_COMPARISON_SAMPLE &&
            item.priorReviewCount >= MIN_RATING_COMPARISON_SAMPLE &&
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

describe('Google’s own numbers on the Properties list (decision 16)', () => {
  it('leads each row with the number and count Google shows, current within a day', async () => {
    // Act
    const result = await fleetOf([row(PROP_A, { google: google() })])(baseInput)

    // Assert
    expect(result.entries[0]?.google).toEqual({
      shows: 4.3,
      reviewCount: 812,
      asOf: GOOGLE_VERIFIED.toISOString(),
      current: true,
    })
  })

  it('keeps Google’s last numbers with their date once they are over a day old', async () => {
    // Arrange
    const stale = google({ verifiedAt: new Date('2025-06-14T11:59:59Z') })

    // Act
    const result = await fleetOf([row(PROP_A, { google: stale })])(baseInput)

    // Assert
    expect(result.entries[0]?.google).toMatchObject({ shows: 4.3, current: false })
  })

  it('treats numbers read under an inactive binding as not current', async () => {
    // Act
    const result = await fleetOf([
      row(PROP_A, { google: google({ bindingActive: false }) }),
    ])(baseInput)

    // Assert
    expect(result.entries[0]?.google?.current).toBe(false)
  })

  it('has no Google numbers for a Property Google never sent any for', async () => {
    // Act
    const result = await fleetOf([row(PROP_A)])(baseInput)

    // Assert
    expect(result.entries[0]?.google).toBeNull()
  })
})

describe('the Google goal column', () => {
  it('names the stored target, mode and last known status of an active goal', async () => {
    // Arrange
    const goal = {
      mode: 'climb' as const,
      targetTenths: 45,
      lastStatus: 'on_pace' as const,
    }

    // Act
    const result = await fleetOf([row(PROP_A, { google: google(), ratingGoal: goal })])(
      baseInput,
    )

    // Assert
    expect(result.entries[0]?.ratingGoal).toEqual({
      kind: 'set',
      mode: 'climb',
      target: 4.5,
      status: 'on_pace',
    })
  })

  it('offers a goal to an active Property Google counts ten reviews for', async () => {
    // Act
    const result = await fleetOf([
      row(PROP_A, { google: google({ reviewCount: 10 }) }),
      row(PROP_B, { google: google({ reviewCount: 9 }) }),
    ])(baseInput)

    // Assert
    expect(result.entries.map((entry) => entry.ratingGoal)).toEqual([
      { kind: 'none', offered: true },
      { kind: 'none', offered: false },
    ])
  })

  it('offers none to a paused Property or one without Google’s numbers', async () => {
    // Act
    const result = await fleetOf([
      row(PROP_A, { google: google(), lifecycleActive: false }),
      row(PROP_B),
    ])(baseInput)

    // Assert
    expect(result.entries.map((entry) => entry.ratingGoal)).toEqual([
      { kind: 'none', offered: false },
      { kind: 'none', offered: false },
    ])
  })

  it('says nothing about goals to a reader whose goal read is off', async () => {
    // Act
    const result = await fleetOf([row(PROP_A, { google: google() })])({
      ...baseInput,
      goalReadEnabled: false,
    })

    // Assert
    expect(result.entries[0]?.ratingGoal).toBeNull()
  })
})
