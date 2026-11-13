import { describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import { getDashboardData } from './get-dashboard-data'
import { getPropertyOverview } from './get-property-overview'
import type { GetReviewInboxItemIds } from '#/contexts/inbox/application/use-cases/get-review-inbox-item-ids'
import { getDb } from '#/shared/db'
import { createServingStats } from '#/contexts/review/infrastructure/serving-stats'
import {
  recordedDashboardRepo,
  seedDashboardProperty,
  seedDashboardReview,
} from '../../infrastructure/testing/dashboard-fixtures'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const ORG = organizationId('org-overview')
const PROPERTY = propertyId('a0000000-0000-4000-8000-000000000001')
const ADMIN = buildTestAuthContext({ organizationId: ORG, role: 'AccountAdmin' })
const last30Days = {
  organizationId: ORG,
  propertyId: PROPERTY,
  portalId: null,
  startDate: new Date('2026-07-26T12:00:00.000Z'),
  endDate: NOW,
  timeRange: '30d' as const,
  propertyTimezone: 'UTC',
}
const allTime = {
  ...last30Days,
  startDate: new Date('2020-01-01T00:00:00.000Z'),
  timeRange: 'all' as const,
}

/** An Inbox that opens none of the reviews, for the tests that are not about links. */
const NO_INBOX_ITEMS = { getReviewInboxItemIds: async () => new Map() }

const ORG_B = organizationId('org-overview-b')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: ORG_B,
  tables: ['replies', 'reviews', 'metric_readings', 'properties'],
})

const seedProperty = () =>
  seedDashboardProperty(getPool(), { id: PROPERTY, organizationId: ORG })

const review = (daysBefore: number, rating: number, text?: string) =>
  seedDashboardReview(getPool(), {
    organizationId: ORG,
    propertyId: PROPERTY,
    now: NOW,
    rating,
    daysBefore,
    text,
  })

describe('getPropertyOverview', () => {
  it('reuses the dashboard KPI snapshot when deriving attention signals', async () => {
    const { repo, calls } = recordedDashboardRepo(
      getDb(),
      createServingStats({ db: getDb(), clock: () => NOW }),
    )
    await seedProperty()
    // Ten Reviews a window is the smallest sample a rating comparison is shown for.
    for (let day = 1; day <= 10; day += 1) await review(day, 3)
    for (let day = 35; day <= 44; day += 1) await review(day, 5)
    const attention: AttentionSignalsPort = {
      getAttentionCounts: async () => ({
        overdue: 99,
        itemsToTriage: 4,
        escalated: 2,
        goalsBehindPace: 1,
        attentionWork: 5,
      }),
    }
    const getOverview = getPropertyOverview({
      getDashboardData: getDashboardData({ repo, propertyAccess: async () => null }),
      propertyAccess: async () => null,
      attention,
      inboxTargets: {
        getGoogleReviewTargetCountsByProperty: async (input) => {
          expect(input).toEqual({
            organizationId: organizationId('org-overview'),
            propertyIds: [propertyId('a0000000-0000-4000-8000-000000000001')],
            now: NOW,
          })
          return new Map([
            [
              propertyId('a0000000-0000-4000-8000-000000000001'),
              { activeCount: 3, overdueCount: 3 },
            ],
          ])
        },
      },
      inboxItems: NO_INBOX_ITEMS,
      clock: () => NOW,
      googleNumbers: async () => null,
    })

    const result = await getOverview(last30Days, ADMIN)

    expect(result.dashboard.kpis.reviews).toEqual({ value: 10, priorValue: 10, trend: 0 })
    expect(result.dashboard.kpis.avgRating).toMatchObject({ value: 3, priorValue: 5 })
    expect(result.signals).toEqual({
      overdue: 3,
      itemsToTriage: 4,
      escalated: 2,
      goalsBehindPace: 1,
      ratingDrop: true,
      needsAttention: 6,
    })
    expect(calls.filter((call) => call === 'getKPIs')).toHaveLength(1)
  })

  it('leads the all-time read with Google’s own number and count, and reads them only there', async () => {
    // Arrange
    const { repo } = recordedDashboardRepo(
      getDb(),
      createServingStats({ db: getDb(), clock: () => NOW }),
    )
    const google = {
      shows: 4.3,
      reviewCount: 812,
      asOf: '2026-08-25T09:00:00.000Z',
      current: true,
    }
    const googleNumbers = vi.fn(async () => google)
    const getOverview = getPropertyOverview({
      getDashboardData: getDashboardData({ repo, propertyAccess: async () => null }),
      propertyAccess: async () => null,
      attention: {
        getAttentionCounts: async () => ({
          overdue: 0,
          itemsToTriage: 0,
          escalated: 0,
          goalsBehindPace: 0,
          attentionWork: 0,
        }),
      },
      inboxTargets: { getGoogleReviewTargetCountsByProperty: async () => new Map() },
      inboxItems: NO_INBOX_ITEMS,
      clock: () => NOW,
      googleNumbers,
    })

    // Act
    const overview = await getOverview(allTime, ADMIN)
    const windowed = await getOverview(last30Days, ADMIN)

    // Assert
    expect(overview.google).toEqual(google)
    expect(googleNumbers).toHaveBeenCalledWith(ORG, PROPERTY, NOW)
    // Google's numbers have no window: a 30-day read does not read them again.
    expect(windowed.google).toBeNull()
    expect(googleNumbers).toHaveBeenCalledOnce()
  })

  it('refuses a manager with no grant on the Property before anything is read', async () => {
    const { repo, calls } = recordedDashboardRepo(
      getDb(),
      createServingStats({ db: getDb(), clock: () => NOW }),
    )
    const getAttentionCounts = vi.fn<AttentionSignalsPort['getAttentionCounts']>()
    const getGoogleReviewTargetCountsByProperty = vi.fn(async () => new Map())
    const googleNumbers = vi.fn(async () => null)
    const grantsElsewhere = async () => [
      propertyId('a0000000-0000-4000-8000-000000000002'),
    ]
    const getOverview = getPropertyOverview({
      getDashboardData: getDashboardData({ repo, propertyAccess: grantsElsewhere }),
      propertyAccess: grantsElsewhere,
      attention: { getAttentionCounts },
      inboxTargets: { getGoogleReviewTargetCountsByProperty },
      inboxItems: NO_INBOX_ITEMS,
      clock: () => NOW,
      googleNumbers,
    })
    const manager = buildTestAuthContext({ organizationId: ORG, role: 'PropertyManager' })

    await expect(getOverview(last30Days, manager)).rejects.toMatchObject({
      _tag: 'DashboardError',
      code: 'forbidden',
    })
    expect(calls).toEqual([])
    expect(getAttentionCounts).not.toHaveBeenCalled()
    expect(getGoogleReviewTargetCountsByProperty).not.toHaveBeenCalled()
    expect(googleNumbers).not.toHaveBeenCalled()
  })

  // A Member holds dashboard.read for the staff dashboard, not
  // dashboard.fleet_read: the attention band (reply targets past due, items to
  // triage, escalations) is not theirs to read, grant or no grant.
  it('refuses a Member granted the Property before anything is read', async () => {
    const { repo, calls } = recordedDashboardRepo(
      getDb(),
      createServingStats({ db: getDb(), clock: () => NOW }),
    )
    const getAttentionCounts = vi.fn<AttentionSignalsPort['getAttentionCounts']>()
    const getGoogleReviewTargetCountsByProperty = vi.fn(async () => new Map())
    const grantsHere = async () => [PROPERTY]
    const getOverview = getPropertyOverview({
      getDashboardData: getDashboardData({ repo, propertyAccess: grantsHere }),
      propertyAccess: grantsHere,
      attention: { getAttentionCounts },
      inboxTargets: { getGoogleReviewTargetCountsByProperty },
      inboxItems: NO_INBOX_ITEMS,
      clock: () => NOW,
      googleNumbers: async () => null,
    })
    const member = buildTestAuthContext({ organizationId: ORG, role: 'Member' })

    await expect(getOverview(last30Days, member)).rejects.toMatchObject({
      _tag: 'DashboardError',
      code: 'forbidden',
    })
    expect(calls).toEqual([])
    expect(getAttentionCounts).not.toHaveBeenCalled()
    expect(getGoogleReviewTargetCountsByProperty).not.toHaveBeenCalled()
  })

  it('serves a manager granted the Property', async () => {
    const { repo } = recordedDashboardRepo(
      getDb(),
      createServingStats({ db: getDb(), clock: () => NOW }),
    )
    const grantsHere = async () => [PROPERTY]
    const getOverview = getPropertyOverview({
      getDashboardData: getDashboardData({ repo, propertyAccess: grantsHere }),
      propertyAccess: grantsHere,
      attention: {
        getAttentionCounts: async () => ({
          overdue: 0,
          itemsToTriage: 7,
          escalated: 2,
          goalsBehindPace: 0,
          attentionWork: 9,
        }),
      },
      inboxTargets: { getGoogleReviewTargetCountsByProperty: async () => new Map() },
      inboxItems: NO_INBOX_ITEMS,
      clock: () => NOW,
      googleNumbers: async () => null,
    })
    const manager = buildTestAuthContext({ organizationId: ORG, role: 'PropertyManager' })

    const overview = await getOverview(last30Days, manager)

    expect(overview.signals).toMatchObject({ itemsToTriage: 7, escalated: 2 })
  })
})

describe('getPropertyOverview recent reviews', () => {
  const ITEM = inboxItemId('70000000-0000-4000-8000-00000000000a')

  // Two Reviews, the newer first: the Overview lists them by when they were reviewed.
  const seedTwoReviews = async () => {
    await seedProperty()
    const withItem = reviewId(await review(1, 2, 'The room was not ready.'))
    const withoutItem = reviewId(await review(2, 2, 'The room was not ready.'))
    return { withItem, withoutItem }
  }

  const overviewWith = (getReviewInboxItemIds: GetReviewInboxItemIds) => {
    const { repo } = recordedDashboardRepo(
      getDb(),
      createServingStats({ db: getDb(), clock: () => NOW }),
    )
    return getPropertyOverview({
      getDashboardData: getDashboardData({ repo, propertyAccess: async () => null }),
      propertyAccess: async () => null,
      attention: {
        getAttentionCounts: async () => ({
          overdue: 0,
          itemsToTriage: 0,
          escalated: 0,
          goalsBehindPace: 0,
          attentionWork: 0,
        }),
      },
      inboxTargets: { getGoogleReviewTargetCountsByProperty: async () => new Map() },
      inboxItems: { getReviewInboxItemIds },
      clock: () => NOW,
      googleNumbers: async () => null,
    })
  }

  it('gives each recent review the Inbox item that opens it, in one lookup', async () => {
    // Arrange
    const { withItem, withoutItem } = await seedTwoReviews()
    const lookup = vi.fn<GetReviewInboxItemIds>(async () => new Map([[withItem, ITEM]]))

    // Act
    const result = await overviewWith(lookup)(allTime, ADMIN)

    // Assert: the item id is carried; a review the reader has no item for reads null.
    expect(result.dashboard.recentReviews.map((r) => [r.id, r.inboxItemId])).toEqual([
      [withItem, ITEM],
      [withoutItem, null],
    ])
    expect(lookup).toHaveBeenCalledOnce()
    expect(lookup).toHaveBeenCalledWith(
      { propertyId: PROPERTY, reviewIds: [withItem, withoutItem] },
      ADMIN,
    )
  })

  it('asks the Inbox nothing when there is no recent review to open', async () => {
    await seedProperty()
    const lookup = vi.fn<GetReviewInboxItemIds>(async () => new Map())

    const result = await overviewWith(lookup)(allTime, ADMIN)

    expect(result.dashboard.recentReviews).toEqual([])
    expect(lookup).not.toHaveBeenCalled()
  })
})
