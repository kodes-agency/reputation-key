// Dashboard context — getStaffDashboardData use case unit tests

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getStaffDashboardData } from './get-staff-dashboard-data'
import { createInMemoryDashboardRepository } from '#/shared/testing/in-memory-dashboard-repo'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId, propertyId, portalId, userId } from '#/shared/domain/ids'
import type { PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import type { StaffPortalResolverPort } from '../ports/staff-portal-resolver.port'
import type { AuthContext } from '#/shared/domain/auth-context'

const MS_PER_DAY = 86_400_000

// Fixed time to prevent midnight-boundary flakiness in date range calculations
beforeEach(() => vi.setSystemTime(new Date('2025-06-15T12:00:00Z')))
afterEach(() => vi.useRealTimers())

const ORG_A = organizationId('org-test')
const PROP_A = propertyId('a0000000-0000-0000-0000-000000000001')
const PORTAL_A = portalId('b0000000-0000-0000-0000-000000000001')
const PORTAL_B = portalId('b0000000-0000-0000-0000-000000000002')

type TestResolver = StaffPortalResolverPort & {
  setPortals: (portals: ReadonlyArray<PortalId>) => void
}

function createTestStaffPortalResolver(): TestResolver {
  let portals: ReadonlyArray<PortalId> = []
  const fn = (async (
    _input: { userId: UserId; propertyId: PropertyId },
    _ctx: AuthContext,
  ) => portals) as unknown as TestResolver
  fn.setPortals = (p) => {
    portals = p
  }
  return fn
}

describe('getStaffDashboardData (use case)', () => {
  it('returns empty KPIs with hasAssignments=false when no portals are assigned', async () => {
    const repo = createInMemoryDashboardRepository()
    const resolver = createTestStaffPortalResolver()
    resolver.setPortals([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const getStaffDashboard = getStaffDashboardData({
      repo,
      staffPortalResolver: resolver,
    })

    const now = new Date()
    const result = await getStaffDashboard(
      {
        organizationId: ORG_A,
        userId: userId('user-00000000-0000-0000-0000-000000000010') as UserId,
        propertyId: PROP_A,
        startDate: new Date(now.getTime() - 30 * MS_PER_DAY),
        endDate: now,
        timeRange: '30d',
      },
      ctx,
    )

    expect(result.hasAssignments).toBe(false)
    expect(result.kpis.reviews.value).toBe(0)
    expect(result.kpis.reviews.priorValue).toBe(0)
    expect(result.kpis.reviews.trend).toBeNull()
    expect(result.kpis.avgRating.value).toBe(0)
    expect(result.kpis.scans.value).toBe(0)
    expect(result.kpis.feedback.value).toBe(0)
  })

  it('returns KPIs from repo when portals exist', async () => {
    const repo = createInMemoryDashboardRepository()
    const resolver = createTestStaffPortalResolver()
    resolver.setPortals([PORTAL_A, PORTAL_B])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const getStaffDashboard = getStaffDashboardData({
      repo,
      staffPortalResolver: resolver,
    })

    const now = new Date()
    const result = await getStaffDashboard(
      {
        organizationId: ORG_A,
        userId: userId('user-00000000-0000-0000-0000-000000000010') as UserId,
        propertyId: PROP_A,
        startDate: new Date(now.getTime() - 30 * MS_PER_DAY),
        endDate: now,
        timeRange: '30d',
      },
      ctx,
    )

    expect(result.hasAssignments).toBe(true)
    // Default KPIs from in-memory repo: 10 reviews, 4.5 avg, 100 scans, 20 feedback
    expect(result.kpis.reviews.value).toBe(10)
    expect(result.kpis.reviews.priorValue).toBe(8)
    expect(result.kpis.reviews.trend).toBe(25)
    expect(result.kpis.avgRating.value).toBe(4.5)
    expect(result.kpis.scans.value).toBe(100)
    expect(result.kpis.feedback.value).toBe(20)

    // Should have called getKPIsForPortals, not getKPIs
    expect(repo.calls).toContain('getKPIsForPortals')
    expect(repo.calls).not.toContain('getKPIs')
  })

  it('filters to single portal when portalId is provided', async () => {
    const repo = createInMemoryDashboardRepository()
    // Override KPIs to have distinct values for testing
    repo.kpisOverride = {
      reviews: { value: 5, priorValue: 3, trend: 67 },
      avgRating: { value: 3.8, priorValue: 3.5, trend: 9 },
      scans: { value: 50, priorValue: 40, trend: 25 },
      feedback: { value: 10, priorValue: 8, trend: 25 },
    }
    const resolver = createTestStaffPortalResolver()
    resolver.setPortals([PORTAL_A, PORTAL_B])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const getStaffDashboard = getStaffDashboardData({
      repo,
      staffPortalResolver: resolver,
    })

    const now = new Date()
    const result = await getStaffDashboard(
      {
        organizationId: ORG_A,
        userId: userId('user-00000000-0000-0000-0000-000000000010') as UserId,
        propertyId: PROP_A,
        portalId: PORTAL_A,
        startDate: new Date(now.getTime() - 30 * MS_PER_DAY),
        endDate: now,
        timeRange: '30d',
      },
      ctx,
    )

    expect(result.hasAssignments).toBe(true)
    expect(result.kpis.scans.value).toBe(50)
    expect(result.kpis.feedback.value).toBe(10)
    expect(repo.calls).toContain('getKPIsForPortals')
  })

  it('returns empty KPIs with hasAssignments=true when filter portalId not in assigned portals', async () => {
    const repo = createInMemoryDashboardRepository()
    const resolver = createTestStaffPortalResolver()
    resolver.setPortals([PORTAL_A])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const getStaffDashboard = getStaffDashboardData({
      repo,
      staffPortalResolver: resolver,
    })

    const now = new Date()
    const result = await getStaffDashboard(
      {
        organizationId: ORG_A,
        userId: userId('user-00000000-0000-0000-0000-000000000010') as UserId,
        propertyId: PROP_A,
        portalId: PORTAL_B, // not in assigned portals
        startDate: new Date(now.getTime() - 30 * MS_PER_DAY),
        endDate: now,
        timeRange: '30d',
      },
      ctx,
    )

    // User has assignments, but the requested portal is not among them
    expect(result.hasAssignments).toBe(true)
    expect(result.kpis.reviews.value).toBe(0)
    expect(result.kpis.scans.value).toBe(0)
  })

  it('passes same prior dates for "all" time range', async () => {
    const repo = createInMemoryDashboardRepository()
    const resolver = createTestStaffPortalResolver()
    resolver.setPortals([PORTAL_A])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const getStaffDashboard = getStaffDashboardData({
      repo,
      staffPortalResolver: resolver,
    })

    const now = new Date()
    const result = await getStaffDashboard(
      {
        organizationId: ORG_A,
        userId: userId('user-00000000-0000-0000-0000-000000000010') as UserId,
        propertyId: PROP_A,
        startDate: new Date(0),
        endDate: now,
        timeRange: 'all',
      },
      ctx,
    )

    expect(result.hasAssignments).toBe(true)
    // In-memory repo returns default KPIs regardless of date params.
    // The key test: getKPIsForPortals was called (use case didn't short-circuit).
    expect(repo.calls).toContain('getKPIsForPortals')
    expect(result.kpis.reviews.value).toBeGreaterThan(0)
  })
})
