// Dashboard context — getFleetOverview use case unit tests

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getFleetOverview } from './get-fleet-overview'
import type { FleetProperty } from './get-fleet-overview'
import { createInMemoryDashboardRepository } from '#/shared/testing/in-memory-dashboard-repo'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { AttentionSignalsPort } from '../ports/attention-signals.port'

const MS_PER_DAY = 86_400_000

// Fixed time to prevent midnight-boundary flakiness in date range calculations
beforeEach(() => vi.setSystemTime(new Date('2025-06-15T12:00:00Z')))
afterEach(() => vi.useRealTimers())
const ORG = organizationId('org-test')
const PROP_A: FleetProperty = {
  propertyId: propertyId('a0000000-0000-0000-0000-000000000001'),
  name: 'Alpha',
  slug: 'alpha',
  timezone: 'UTC',
}
const PROP_B: FleetProperty = {
  propertyId: propertyId('b0000000-0000-0000-0000-000000000001'),
  name: 'Bravo',
  slug: 'bravo',
  timezone: 'UTC',
}

type SignalCounts = {
  unanswered: number
  newFeedback: number
  escalated: number
  goalsBehindPace: number
}

function mockSignals(counts: Record<string, SignalCounts>): AttentionSignalsPort {
  const lookup = (pid: unknown) =>
    counts[String(pid)] ?? {
      unanswered: 0,
      newFeedback: 0,
      escalated: 0,
      goalsBehindPace: 0,
    }
  return {
    getUnansweredReviewCount: async (_o, pid) => lookup(pid).unanswered,
    getNewInboxItemCount: async (_o, pid) => lookup(pid).newFeedback,
    getEscalatedInboxItemCount: async (_o, pid) => lookup(pid).escalated,
    getGoalsBehindPaceCount: async (_o, pid) => lookup(pid).goalsBehindPace,
  }
}

const thirtyDayRange = (now = new Date()) => ({
  startDate: new Date(now.getTime() - 30 * MS_PER_DAY),
  endDate: now,
  timeRange: '30d' as const,
})

describe('getFleetOverview (use case)', () => {
  it('sorts entries by total attention (most-needing first) and sums totals', async () => {
    const repo = createInMemoryDashboardRepository()
    const signals = mockSignals({
      [String(PROP_A.propertyId)]: {
        unanswered: 3,
        newFeedback: 1,
        escalated: 0,
        goalsBehindPace: 1,
      }, // total 5
      [String(PROP_B.propertyId)]: {
        unanswered: 0,
        newFeedback: 0,
        escalated: 0,
        goalsBehindPace: 0,
      }, // total 0
    })
    const getFleet = getFleetOverview({ repo, signals })

    const result = await getFleet({
      organizationId: ORG,
      properties: [PROP_A, PROP_B],
      slaHours: 48,
      ...thirtyDayRange(),
    })

    expect(result.entries).toHaveLength(2)
    expect(result.entries[0].name).toBe('Alpha') // 5 attention → first
    expect(result.entries[0].totalAttention).toBe(5)
    expect(result.entries[1].name).toBe('Bravo') // 0 attention → last
    expect(result.entries[1].totalAttention).toBe(0)
    expect(result.totals.propertyCount).toBe(2)
    expect(result.totals.totalAttention).toBe(5)
    // Both default to avgRating 4.5 → overall 4.5
    expect(result.totals.overallAvgRating).toBe(4.5)
  })

  it('flags ratingDrop (counts as 1) when avg rating fell >= 0.3 vs prior', async () => {
    const repo = createInMemoryDashboardRepository()
    repo.kpisOverride = {
      reviews: { value: 10, priorValue: 10, trend: 0 },
      avgRating: { value: 4.0, priorValue: 4.4, trend: -9 }, // drop 0.4 >= 0.3
      scans: { value: 100, priorValue: 100, trend: 0 },
      feedback: { value: 20, priorValue: 20, trend: 0 },
    }
    const getFleet = getFleetOverview({ repo, signals: mockSignals({}) })

    const result = await getFleet({
      organizationId: ORG,
      properties: [PROP_A],
      slaHours: 48,
      ...thirtyDayRange(),
    })

    expect(result.entries[0].attentionSignals.ratingDrop).toBe(true)
    expect(result.entries[0].totalAttention).toBe(1)
    expect(result.totals.totalAttention).toBe(1)
  })

  it('excludes zero-rated properties from the overall avg rating', async () => {
    const repo = createInMemoryDashboardRepository()
    repo.kpisOverride = {
      reviews: { value: 0, priorValue: 0, trend: null },
      avgRating: { value: 0, priorValue: 0, trend: null },
      scans: { value: 0, priorValue: 0, trend: null },
      feedback: { value: 0, priorValue: 0, trend: null },
    }
    const getFleet = getFleetOverview({ repo, signals: mockSignals({}) })

    const result = await getFleet({
      organizationId: ORG,
      properties: [PROP_A, PROP_B],
      slaHours: 48,
      ...thirtyDayRange(),
    })

    expect(result.totals.overallAvgRating).toBe(0) // no rated properties
    expect(result.entries.every((e) => e.avgRating === 0)).toBe(true)
    expect(result.totals.propertyCount).toBe(2)
  })
})
