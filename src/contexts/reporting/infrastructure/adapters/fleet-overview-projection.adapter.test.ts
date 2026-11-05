import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { FleetOverviewProjectionRow } from '../../application/ports/fleet-overview-projection.port'
import { getFleetOverview } from '../../application/use-cases/get-fleet-overview'
import { createFleetOverviewProjectionAdapter } from './fleet-overview-projection.adapter'

const NOW = new Date('2026-08-09T12:00:00.000Z')
const ORG = organizationId('org-fleet-bounded')
const USER = userId('fleet-manager')

type FleetProperty = Pick<
  FleetOverviewProjectionRow,
  'propertyId' | 'name' | 'slug' | 'timezone'
>

function properties(count: number): FleetProperty[] {
  return Array.from({ length: count }, (_, index) => ({
    propertyId: propertyId(
      `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
    ),
    name: `Property ${String(index + 1).padStart(5, '0')}`,
    slug: `property-${index + 1}`,
    timezone: 'UTC',
  }))
}

function mainRows(items: readonly FleetProperty[], total: number) {
  if (total === 0) {
    return [
      {
        property_id: null,
        property_count: '0',
        has_more: false,
      },
    ]
  }
  return items.slice(0, 50).map((item) => ({
    property_id: item.propertyId,
    name: item.name,
    cursor_lower_name: item.name.toLowerCase(),
    slug: item.slug,
    timezone: item.timezone,
    property_count: String(total),
    has_more: total > 50,
    items_to_triage: '0',
    escalated: '0',
    needs_attention: '0',
    total_attention_work: '0',
  }))
}

function fakeDatabase(
  getCount: () => number,
  extra: Readonly<Record<string, unknown>> = {},
): {
  db: Database
  calls: () => number
  statements: string[]
} {
  let calls = 0
  const statements: string[] = []
  // One read is three statements, however large the fleet: the timeout setting,
  // the page, and the running goal months in scope.
  const execute = async (query: SQL) => {
    statements.push(new PgDialect().sqlToQuery(query).sql)
    calls += 1
    const phase = (calls - 1) % 3
    if (phase === 1) {
      const items = properties(getCount())
      return {
        rows: mainRows(items, items.length).map((row) => ({ ...row, ...extra })),
      }
    }
    return { rows: [] }
  }
  const tx = { execute }
  const db = {
    transaction: async (run: (value: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as Database
  return { db, calls: () => calls, statements }
}

const inboxTargets = {
  getGoogleReviewTargetCountsByProperty: async (targetInput: {
    propertyIds: readonly ReturnType<typeof propertyId>[]
  }) =>
    new Map(
      targetInput.propertyIds.map((id) => [id, { activeCount: 0, overdueCount: 0 }]),
    ),
}
const input = {
  organizationId: ORG,
  scope: { userId: USER, organizationWide: true },
  goalReadEnabled: true,
}
const resolveAccessiblePropertyIds = async (
  _organizationId: unknown,
  resolvedScope: { organizationWide: boolean },
) => (resolvedScope.organizationWide ? null : [])

describe('fleet overview bulk projection', () => {
  it('keeps the production use case constant-query and bounded at 5,000 properties', async () => {
    let activeCount = 10
    const fake = fakeDatabase(() => activeCount)
    const observed: unknown[] = []
    const getFleet = getFleetOverview({
      projection: createFleetOverviewProjectionAdapter(fake.db, {
        onRead: (value) => observed.push(value),
      }),
      resolveAccessiblePropertyIds,
      clock: () => NOW,
      inboxTargets,
    })

    const ten = await getFleet(input)
    const tenCalls = fake.calls()
    activeCount = 5_000
    const fleet = await getFleet(input)
    const fleetCalls = fake.calls() - tenCalls

    expect(ten.entries).toHaveLength(10)
    expect(fleet.entries).toHaveLength(50)
    expect(fleet.totals.propertyCount).toBe(5_000)
    expect(fleet.nextCursor).not.toBeNull()
    expect(tenCalls).toBe(3)
    expect(fleetCalls).toBe(tenCalls)
    expect(fleetCalls).toBeLessThanOrEqual(3)
    expect(observed).toEqual([
      {
        propertyCount: 10,
        returnedRows: 10,
        durationMs: expect.any(Number),
      },
      {
        propertyCount: 5_000,
        returnedRows: 50,
        durationMs: expect.any(Number),
      },
    ])
  })

  it('reads the list without scanning historical metric readings or corrections', async () => {
    const fake = fakeDatabase(() => 5_000)
    const getFleet = getFleetOverview({
      projection: createFleetOverviewProjectionAdapter(fake.db),
      resolveAccessiblePropertyIds,
      clock: () => NOW,
      inboxTargets,
    })

    await getFleet({ ...input, goalReadEnabled: false })

    expect(fake.calls()).toBe(2)
    expect(fake.statements.join('\n')).not.toMatch(/\bmetric_(readings|corrections)\b/)
  })

  it('returns an intentional empty fleet from an empty database scope', async () => {
    const fake = fakeDatabase(() => 0)
    const getFleet = getFleetOverview({
      projection: createFleetOverviewProjectionAdapter(fake.db),
      clock: () => NOW,
      resolveAccessiblePropertyIds,
      inboxTargets,
    })

    const result = await getFleet({
      ...input,
      scope: { userId: USER, organizationWide: false },
    })

    expect(result).toEqual({
      entries: [],
      totals: {
        propertyCount: 0,
        totalAttention: 0,
      },
      nextCursor: null,
    })
    expect(fake.calls()).toBe(3)
  })

  it('reads no goal when the reader may not use goals', async () => {
    const fake = fakeDatabase(() => 10)
    const getFleet = getFleetOverview({
      projection: createFleetOverviewProjectionAdapter(fake.db),
      clock: () => NOW,
      resolveAccessiblePropertyIds,
      inboxTargets,
    })

    await getFleet({ ...input, goalReadEnabled: false })

    expect(fake.calls()).toBe(2)
  })
})

describe('Google’s own numbers and the stored rating goal on a fleet row', () => {
  const projectionRow = async (extra: Readonly<Record<string, unknown>>) => {
    const fake = fakeDatabase(() => 1, extra)
    const result = await createFleetOverviewProjectionAdapter(fake.db).read({
      organizationId: ORG,
      accessiblePropertyIds: null,
      goalReadEnabled: true,
      cursor: null,
      now: NOW,
    })
    return result.rows[0]
  }

  it('reads the snapshot at the current binding and the active goal as stored', async () => {
    // Act
    const row = await projectionRow({
      lifecycle_active: true,
      google_binding_active: true,
      google_review_count: 812,
      google_average_rating: 4.300000190734863,
      google_verified_at: new Date('2026-08-09T09:00:00.000Z'),
      rating_goal_mode: 'climb',
      rating_goal_target_tenths: 45,
      rating_goal_status: 'below_pace',
    })

    // Assert
    expect(row).toMatchObject({
      lifecycleActive: true,
      google: {
        reviewCount: 812,
        averageRating: 4.300000190734863,
        verifiedAt: new Date('2026-08-09T09:00:00.000Z'),
        bindingActive: true,
      },
      ratingGoal: { mode: 'climb', targetTenths: 45, lastStatus: 'below_pace' },
    })
  })

  it('has no Google numbers and no goal where the joins found none', async () => {
    // Act
    const row = await projectionRow({
      lifecycle_active: false,
      google_binding_active: false,
      google_review_count: null,
      google_average_rating: null,
      google_verified_at: null,
      rating_goal_mode: null,
      rating_goal_target_tenths: null,
      rating_goal_status: null,
    })

    // Assert
    expect(row).toMatchObject({ lifecycleActive: false, google: null, ratingGoal: null })
  })
})
