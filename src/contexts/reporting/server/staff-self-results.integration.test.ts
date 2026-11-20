// A staff account's own results, goals and colleague list, called as the signed-in
// member over PostgreSQL with the real session-bound participation rule, the
// execution policy and the Reporting readers. The clock sits in the middle of
// the seeded goal's month.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  GOAL_CLEANUP_TABLES,
  GOAL_CLEANUP_TRIGGERS,
} from '#/shared/testing/server-function-goal-seeds'
import { PORTAL_SEED_CLEANUP_TABLES } from '#/shared/testing/server-function-portal-seeds'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { getMyColleagues, getMyGoals, getMyResults } from './staff-self-results'

const NOW = new Date('2026-08-15T12:00:00.000Z')

const harness = setupServerFunctionHarness({
  clock: () => NOW,
  env: { STAFF_SCAN_TARGETS_ENABLED: 'true' },
  cleanupTables: [
    'metric_readings',
    ...GOAL_CLEANUP_TABLES,
    ...PORTAL_SEED_CLEANUP_TABLES,
  ],
  disabledTriggers: GOAL_CLEANUP_TRIGGERS,
})

async function hotel(options: { colleagueListEnabled?: boolean } = {}) {
  const organization = await harness.seedOrganization()
  const member = await harness.seedMember(organization, 'Member')
  const property = await harness.seedProperty(organization)
  const staff = await harness.seedStaffParticipation(member, property, {
    displayName: 'Polly',
    colleagueListEnabled: options.colleagueListEnabled ?? true,
  })
  const portal = staff.personalPortal!
  return { organization, member, property, staff, portal }
}

const CACHE_CONTROL = 'private, no-store'

describe('getMyResults', () => {
  it("reads the account's own participation with the approved fields only", async () => {
    const { member, property, staff, portal } = await hotel()
    await harness.seedMetricReading(property, {
      count: 4,
      at: new Date('2026-08-12T09:00:00.000Z'),
      portalId: portal.id,
    })

    const week = await harness.callAs(member, () =>
      getMyResults({
        data: { participationId: staff.participationId, period: 'week' },
      }),
    )
    const today = await harness.callAs(member, () =>
      getMyResults({
        data: { participationId: staff.participationId, period: 'today' },
      }),
    )

    const month = await harness.callAs(member, () =>
      getMyResults({
        data: { participationId: staff.participationId, period: 'month' },
      }),
    )
    expect(Object.keys(week).sort()).toEqual(
      ['ratingCount', 'ratingsCutoff', 'scans', 'series'].sort(),
    )
    expect(month.scans).toBe(4)
    expect(Object.keys(today).sort()).toEqual(['scans', 'series'])
  })

  it("refuses another participation's id and any random id", async () => {
    const { member } = await hotel()
    const colleague = await hotel()

    for (const participationId of [colleague.staff.participationId, randomUUID()]) {
      await expect(
        harness.callAs(member, () =>
          getMyResults({ data: { participationId, period: 'week' } }),
        ),
      ).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    }
  })

  it('refuses an account whose person has no personal Portal at the Property', async () => {
    const organization = await harness.seedOrganization()
    const member = await harness.seedMember(organization, 'Member')
    const property = await harness.seedProperty(organization)
    const staff = await harness.seedStaffParticipation(member, property, {
      personalPortal: null,
    })

    await expect(
      harness.callAs(member, () =>
        getMyResults({
          data: { participationId: staff.participationId, period: 'week' },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('refuses a request with no session', async () => {
    const { staff } = await hotel()

    await expect(
      harness.callAs(null, () =>
        getMyResults({
          data: { participationId: staff.participationId, period: 'week' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('accepts only a participation that is an id', async () => {
    const { member } = await hotel()

    await expect(
      harness.callAs(member, () =>
        getMyResults({ data: { participationId: 'nope', period: 'week' } }),
      ),
    ).rejects.toThrow(/participationId/)
  })
})

describe('getMyGoals', () => {
  it("returns only the goal's id, name, target and scans", async () => {
    const { member, property, staff, portal } = await hotel()
    const group = await harness.seedPortalGroup(property, [portal], { name: 'Desk' })
    const seeded = await harness.seedGoalProgram(property, {
      target: 20,
      subject: { kind: 'portal_group', groupId: group.id },
    })
    await harness.seedMetricReading(property, {
      count: 3,
      at: new Date('2026-08-05T09:00:00.000Z'),
      portalId: portal.id,
      groupId: group.id,
    })

    const { goals } = await harness.callAs(member, () =>
      getMyGoals({ data: { participationId: staff.participationId } }),
    )

    expect(goals).toEqual([{ id: seeded.programId, name: 'Desk', target: 20, scans: 3 }])
  })

  it('answers no goals for a person with none', async () => {
    const { member, staff } = await hotel()

    await expect(
      harness.callAs(member, () =>
        getMyGoals({ data: { participationId: staff.participationId } }),
      ),
    ).resolves.toEqual({ goals: [] })
  })
})

describe('getMyColleagues', () => {
  it("lists the Property's roster with scan counts, zeros included, and marks the caller", async () => {
    const { organization, member, property, staff, portal } = await hotel()
    const other = await harness.seedMember(organization, 'Member')
    const alex = await harness.seedStaffParticipation(other, property, {
      displayName: 'Alex',
    })
    expect(alex.personalPortal).not.toBeNull()
    await harness.seedMetricReading(property, {
      count: 4,
      at: new Date('2026-08-12T09:00:00.000Z'),
      portalId: portal.id,
    })

    const { colleagues } = await harness.callAs(member, () =>
      getMyColleagues({
        data: { participationId: staff.participationId, period: 'week' },
      }),
    )

    expect(colleagues).toEqual(
      expect.arrayContaining([
        { displayName: 'Polly', scans: 4, isYou: true },
        { displayName: 'Alex', scans: 0, isYou: false },
      ]),
    )
    expect(colleagues).toHaveLength(2)
  })

  it('refuses the list while the Property setting is off', async () => {
    const { member, staff } = await hotel({ colleagueListEnabled: false })

    await expect(
      harness.callAs(member, () =>
        getMyColleagues({
          data: { participationId: staff.participationId, period: 'month' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'colleague_list_disabled', status: 403 })
  })
})

describe('personal results are private', () => {
  it('marks every personal read as non-cacheable, also when it refuses', async () => {
    const { member, staff } = await hotel()
    const id = staff.participationId

    const responses = await Promise.all([
      harness.respondAs(member, () =>
        getMyResults({ data: { participationId: id, period: 'month' } }),
      ),
      harness.respondAs(member, () => getMyGoals({ data: { participationId: id } })),
      harness.respondAs(member, () =>
        getMyColleagues({ data: { participationId: id, period: 'week' } }),
      ),
      harness.respondAs(member, () =>
        getMyResults({ data: { participationId: randomUUID(), period: 'week' } }),
      ),
    ])

    expect(responses.map((response) => response.ok)).toEqual([true, true, true, false])
    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe(CACHE_CONTROL)
    }
  })
})
