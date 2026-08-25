import { describe, expect, it } from 'vitest'
import { getAttentionSignals } from './get-attention-signals'
import { createInMemoryDashboardRepository } from '#/shared/testing/in-memory-dashboard-repo'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { AttentionSignalsPort } from '../ports/attention-signals.port'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const ORG = organizationId('org-test')
const PROPERTY = propertyId('a0000000-0000-4000-8000-000000000001')

const signals: AttentionSignalsPort = {
  getUnansweredReviewCount: async () => 0,
  getNewInboxItemCount: async () => 0,
  getEscalatedInboxItemCount: async () => 0,
  getGoalsBehindPaceCount: async () => 0,
}

describe('getAttentionSignals', () => {
  it('does not infer a rating drop when all-time has no comparison period', async () => {
    const repo = createInMemoryDashboardRepository()
    repo.kpisOverride = {
      reviews: { value: 10, priorValue: 12, trend: -17 },
      avgRating: { value: 4, priorValue: 4.4, trend: -9 },
      scans: { value: 100, priorValue: 100, trend: 0 },
      feedback: { value: 20, priorValue: 20, trend: 0 },
    }
    const getSignals = getAttentionSignals({ repo, signals, clock: () => NOW })

    const result = await getSignals({
      organizationId: ORG,
      propertyId: PROPERTY,
      slaHours: 48,
      startDate: new Date(0),
      endDate: NOW,
      timeRange: 'all',
      propertyTimezone: 'UTC',
    })

    expect(result.ratingDrop).toBe(false)
  })
})
