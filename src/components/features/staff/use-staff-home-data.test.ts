// useStaffHomeData tests — the empty-state decision table and the query wiring,
// exercised against in-memory staff fns (the .storybook/in-memory prop-channel
// pattern: the route passes real server fns; tests pass in-memory ones).
// The hook's suspense rendering is covered by the StaffHomePage stories.

import { describe, it, expect, vi } from 'vitest'
import {
  decideStaffHomeEmptyState,
  staffHomeQueries,
  type StaffHomeFns,
} from './use-staff-home-data'
import { dashboardKeys, reviewKeys, staffKeys } from '#/shared/queries/query-keys'

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

const setup = () => {
  const getStaffDashboardData = vi.fn(async () => ({ kpis: null, hasAssignments: true }))
  const listStaffPortals = vi.fn(async () => ({ portals: [] }))
  const getStaffRecentActivity = vi.fn(async () => ({ reviews: [] }))
  // server-fn types carry createServerFn metadata the in-memory fns don't have —
  // the double cast bridges that brand (same justification as the storybook fns).
  const fns = {
    getStaffDashboardData,
    listStaffPortals,
    getStaffRecentActivity,
  } as unknown as StaffHomeFns
  return {
    fns,
    getStaffDashboardData,
    listStaffPortals,
    getStaffRecentActivity,
  }
}

/** The built queryFns close over their args — the query context is unused. */
const callQueryFn = (fn: unknown): Promise<unknown> => (fn as () => Promise<unknown>)()

// ── Empty-state decision table (pure) ───────────────────────────
//
//   propertyId   hasAssignments   → emptyState
//   undefined    —                → 'no-property'
//   ''           —                → 'no-property'
//   defined      false            → 'no-assignments'
//   defined      true             → null

describe('decideStaffHomeEmptyState', () => {
  it('is no-property when no property is selected', () => {
    expect(decideStaffHomeEmptyState(undefined, false)).toBe('no-property')
    expect(decideStaffHomeEmptyState(undefined, true)).toBe('no-property')
    expect(decideStaffHomeEmptyState('', false)).toBe('no-property')
  })

  it('is no-assignments when a property is selected but the staff has none', () => {
    expect(decideStaffHomeEmptyState(PROPERTY_ID, false)).toBe('no-assignments')
  })

  it('is null when the staff has assignments in the selected property', () => {
    expect(decideStaffHomeEmptyState(PROPERTY_ID, true)).toBeNull()
  })
})

// ── Query wiring ────────────────────────────────────────────────

describe('staffHomeQueries', () => {
  it('keys each query by the shared staff-home key factories', () => {
    const { fns } = setup()
    const portalId = 'portal-1'

    const q = staffHomeQueries(fns, PROPERTY_ID, portalId)

    expect(Object.keys(q)).toEqual(['dashboard', 'portals', 'activity'])
    expect(q.dashboard.queryKey).toEqual(
      dashboardKeys.staff({ propertyId: PROPERTY_ID, portalId }),
    )
    expect(q.portals.queryKey).toEqual(staffKeys.portals(PROPERTY_ID))
    expect(q.activity.queryKey).toEqual(reviewKeys.staffActivity(PROPERTY_ID))
  })

  it('routes each queryFn through the injected fns with the server-fn payload shape', async () => {
    const s = setup()
    const portalId = 'portal-1'
    const q = staffHomeQueries(s.fns, PROPERTY_ID, portalId)

    await callQueryFn(q.dashboard.queryFn)
    expect(s.getStaffDashboardData).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY_ID, portalId, timeRange: '30d' },
    })

    await callQueryFn(q.portals.queryFn)
    expect(s.listStaffPortals).toHaveBeenCalledWith({ data: { propertyId: PROPERTY_ID } })

    await callQueryFn(q.activity.queryFn)
    expect(s.getStaffRecentActivity).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY_ID },
    })
  })
})
