// Leaderboard context — metric.recorded handler tests
// Covers Fix 8: a portal event refreshes BOTH scopes (portal + the portal's
// group), and property-level metrics that don't participate are skipped.

import { describe, it, expect, vi } from 'vitest'
import { createEventBus } from '#/shared/events/event-bus'
import { registerLeaderboardEventHandlers } from './index'
import { metricRecorded } from '#/contexts/metric/domain/events'
import type { MetricRecorded } from '#/contexts/metric/domain/events'
import type { LeaderboardRefreshInput } from '../../domain/types'
import {
  metricReadingId,
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import type { MetricKey } from '#/shared/domain/metric-keys'

const ORG = organizationId('org-1')
const PROP = propertyId('00000000-0000-4000-8000-000000000020')
const PORTAL = portalId('00000000-0000-4000-8000-000000000010')
const GROUP = portalGroupId('00000000-0000-4000-8000-000000000099')

type RefreshCall = Pick<LeaderboardRefreshInput, 'scope' | 'metricKey' | 'period'>

function setup(): {
  emit: (event: MetricRecorded) => Promise<void>
  refreshCalls: RefreshCall[]
} {
  const refreshCalls: RefreshCall[] = []
  const refreshLeaderboard = vi.fn(async (input: LeaderboardRefreshInput) => {
    refreshCalls.push({
      scope: input.scope,
      metricKey: input.metricKey,
      period: input.period,
    })
    return { snapshotsRefreshed: 0, entriesWritten: 0 }
  })
  const eventBus = createEventBus()
  registerLeaderboardEventHandlers({ eventBus, refreshLeaderboard })
  return { emit: (event) => eventBus.emit(event), refreshCalls }
}

function makeEvent(overrides: {
  portalId: MetricRecorded['portalId']
  groupId: MetricRecorded['groupId']
  metricKey?: MetricKey
}): MetricRecorded {
  return metricRecorded({
    readingId: metricReadingId('00000000-0000-4000-8000-000000000001'),
    organizationId: ORG,
    propertyId: PROP,
    portalId: overrides.portalId,
    groupId: overrides.groupId,
    metricKey: overrides.metricKey ?? 'portal.scan',
    value: 1,
    occurredAt: new Date('2026-07-01T12:00:00Z'),
  })
}

describe('registerLeaderboardEventHandlers — metric.recorded scope refresh', () => {
  it('refreshes BOTH portal and portal_group when a portal event has a group', async () => {
    const { emit, refreshCalls } = setup()
    await emit(makeEvent({ portalId: PORTAL, groupId: GROUP }))

    expect(refreshCalls).toHaveLength(2)
    expect(refreshCalls.map((c) => c.scope).sort()).toEqual(['portal', 'portal_group'])
    // Every refresh targets the current period + overall composite.
    for (const call of refreshCalls) {
      expect(call.period).toBe('this_month')
      expect(call.metricKey).toBe('overall')
    }
  })

  it('refreshes only the portal scope when a portal event has no group', async () => {
    const { emit, refreshCalls } = setup()
    await emit(makeEvent({ portalId: PORTAL, groupId: null }))

    expect(refreshCalls).toHaveLength(1)
    expect(refreshCalls[0]!.scope).toBe('portal')
  })

  it('refreshes only portal_group for a group-scoped reading with no portal', async () => {
    const { emit, refreshCalls } = setup()
    await emit(makeEvent({ portalId: null, groupId: GROUP }))

    expect(refreshCalls).toHaveLength(1)
    expect(refreshCalls[0]!.scope).toBe('portal_group')
  })

  it('skips refresh entirely for property-level metrics (no portal, no group)', async () => {
    const { emit, refreshCalls } = setup()
    await emit(makeEvent({ portalId: null, groupId: null, metricKey: 'property.review' }))

    expect(refreshCalls).toHaveLength(0)
  })
})
