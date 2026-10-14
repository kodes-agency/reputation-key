import { describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createInMemoryDashboardRepository } from '#/shared/testing/in-memory-dashboard-repo'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import { getDashboardData } from './get-dashboard-data'
import { getPropertyOverview } from './get-property-overview'
import type { MetricKPIValue } from '../../domain/dashboard-types'

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

const metricKpi = (value: number, priorValue: number, trend: number): MetricKPIValue => ({
  value,
  priorValue,
  trend,
  evidence: {
    current: {
      state: 'ready',
      definitionVersionId: 'overview-current',
      sampleCount: value,
      minimumSample: 1,
    },
    prior: {
      state: 'ready',
      definitionVersionId: 'overview-prior',
      sampleCount: priorValue,
      minimumSample: 1,
    },
  },
})

describe('getPropertyOverview', () => {
  it('reuses the dashboard KPI snapshot when deriving attention signals', async () => {
    const repo = createInMemoryDashboardRepository()
    repo.kpisOverride = {
      reviews: { value: 12, priorValue: 10, trend: 20 },
      avgRating: {
        value: 4,
        priorValue: 4.4,
        comparison: -0.4,
        sampleCount: 12,
        priorSampleCount: 10,
        evidence: {
          definitionVersionId: null,
          state: 'ready',
          verifiedThrough: NOW,
          latestActivity: NOW,
          computedAt: NOW,
          completeness: 1,
          availabilityReason: null,
          correctionHead: null,
          sampleCount: 12,
        },
      },
      scans: metricKpi(100, 80, 25),
      feedback: metricKpi(20, 15, 33),
    }
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
      clock: () => NOW,
      googleNumbers: async () => null,
    })

    const result = await getOverview(last30Days, ADMIN)

    expect(result.dashboard.kpis).toBe(repo.kpisOverride)
    expect(result.signals).toEqual({
      overdue: 3,
      itemsToTriage: 4,
      escalated: 2,
      goalsBehindPace: 1,
      ratingDrop: true,
      needsAttention: 6,
    })
    expect(repo.calls.filter((call) => call === 'getKPIs')).toHaveLength(1)
  })

  it('leads with Google’s own number and count, read beside the dashboard', async () => {
    // Arrange
    const repo = createInMemoryDashboardRepository()
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
      clock: () => NOW,
      googleNumbers,
    })

    // Act
    const overview = await getOverview(last30Days, ADMIN)

    // Assert
    expect(overview.google).toEqual(google)
    expect(googleNumbers).toHaveBeenCalledWith(ORG, PROPERTY, NOW)
  })

  it('refuses a manager with no grant on the Property before anything is read', async () => {
    const repo = createInMemoryDashboardRepository()
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
      clock: () => NOW,
      googleNumbers,
    })
    const manager = buildTestAuthContext({ organizationId: ORG, role: 'PropertyManager' })

    await expect(getOverview(last30Days, manager)).rejects.toMatchObject({
      _tag: 'DashboardError',
      code: 'forbidden',
    })
    expect(repo.calls).toEqual([])
    expect(getAttentionCounts).not.toHaveBeenCalled()
    expect(getGoogleReviewTargetCountsByProperty).not.toHaveBeenCalled()
    expect(googleNumbers).not.toHaveBeenCalled()
  })

  // A Member holds dashboard.read for the staff dashboard, not
  // dashboard.fleet_read: the attention band (reply targets past due, items to
  // triage, escalations) is not theirs to read, grant or no grant.
  it('refuses a Member granted the Property before anything is read', async () => {
    const repo = createInMemoryDashboardRepository()
    const getAttentionCounts = vi.fn<AttentionSignalsPort['getAttentionCounts']>()
    const getGoogleReviewTargetCountsByProperty = vi.fn(async () => new Map())
    const grantsHere = async () => [PROPERTY]
    const getOverview = getPropertyOverview({
      getDashboardData: getDashboardData({ repo, propertyAccess: grantsHere }),
      propertyAccess: grantsHere,
      attention: { getAttentionCounts },
      inboxTargets: { getGoogleReviewTargetCountsByProperty },
      clock: () => NOW,
      googleNumbers: async () => null,
    })
    const member = buildTestAuthContext({ organizationId: ORG, role: 'Member' })

    await expect(getOverview(last30Days, member)).rejects.toMatchObject({
      _tag: 'DashboardError',
      code: 'forbidden',
    })
    expect(repo.calls).toEqual([])
    expect(getAttentionCounts).not.toHaveBeenCalled()
    expect(getGoogleReviewTargetCountsByProperty).not.toHaveBeenCalled()
  })

  it('serves a manager granted the Property', async () => {
    const repo = createInMemoryDashboardRepository()
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
      clock: () => NOW,
      googleNumbers: async () => null,
    })
    const manager = buildTestAuthContext({ organizationId: ORG, role: 'PropertyManager' })

    const overview = await getOverview(last30Days, manager)

    expect(overview.signals).toMatchObject({ itemsToTriage: 7, escalated: 2 })
  })
})
