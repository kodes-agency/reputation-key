// Goal Program reads, called as signed-in members over PostgreSQL with the real
// tenant resolution, execution policy (goal.use on the Property) and Reporting
// scoping. The clock sits in the middle of the seeded goals' running month.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  GOAL_CLEANUP_TABLES,
  GOAL_CLEANUP_TRIGGERS,
} from '#/shared/testing/server-function-goal-seeds'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { GoalProgramError } from '../application/use-cases/goal-program-shared'
import { withGoalPrograms } from './goal-program-request.server'
import {
  getGoalListProgress,
  getGoalProgramHistory,
  getGoalProgress,
  listGoalPrograms,
} from './goal-programs'

const NOW = new Date('2026-08-15T12:00:00.000Z')

const harness = setupServerFunctionHarness({
  clock: () => NOW,
  cleanupTables: [...GOAL_CLEANUP_TABLES, 'portal_group_memberships', 'portal_groups'],
  disabledTriggers: GOAL_CLEANUP_TRIGGERS,
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  const goal = await harness.seedGoalProgram(property, { target: 25 })
  return { organization, admin, manager, property, goal }
}

describe('listGoalPrograms', () => {
  it("lists the Property's goals to an AccountAdmin and a granted PropertyManager", async () => {
    const { admin, manager, property, goal } = await hotel()
    await harness.grantProperty(manager, property)

    for (const member of [admin, manager]) {
      const listed = await harness.callAs(member, () =>
        listGoalPrograms({ data: { propertyId: property.id } }),
      )
      expect(listed.programs.map((entry) => entry.program.id)).toEqual([goal.programId])
    }
  })

  it('refuses a PropertyManager without a grant on the Property', async () => {
    const { manager, property } = await hotel()

    await expect(
      harness.callAs(manager, () =>
        listGoalPrograms({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it("never shows another Organization's goals", async () => {
    const { admin } = await hotel()
    const elsewhere = await hotel()

    const listed = await harness.callAs(admin, () =>
      listGoalPrograms({ data: { propertyId: elsewhere.property.id } }),
    )

    expect(listed).toEqual({ programs: [] })
  })

  it('refuses a request with no session', async () => {
    const { property } = await hotel()

    await expect(
      harness.callAs(null, () => listGoalPrograms({ data: { propertyId: property.id } })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })
})

describe('goal progress', () => {
  it('reads the goals of one Portal group subject live for the month so far', async () => {
    const { admin, property } = await hotel()
    const portal = await harness.seedPortal(property)
    const group = await harness.seedPortalGroup(property, [portal])
    const grouped = await harness.seedGoalProgram(property, {
      target: 12,
      subject: { kind: 'portal_group', groupId: group.id },
    })
    await harness.seedMetricReading(property, {
      count: 2,
      at: new Date('2026-08-12T09:00:00.000Z'),
      portalId: portal.id,
      groupId: group.id,
    })

    const progress = await harness.callAs(admin, () =>
      getGoalProgress({
        data: {
          propertyId: property.id,
          subject: { kind: 'portal_group', portalGroupId: group.id },
        },
      }),
    )

    expect(progress.goals).toEqual([
      expect.objectContaining({ programId: grouped.programId }),
    ])
  })

  it('accepts a progress read only for a subject that is an id', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        getGoalProgress({
          data: {
            propertyId: property.id,
            subject: { kind: 'portal_group', portalGroupId: 'not-an-id' },
          },
        }),
      ),
    ).rejects.toThrow(/portalGroupId/)
  })

  it('reads the month so far of every goal on the Goals list in one call', async () => {
    const { admin, property, goal } = await hotel()
    await harness.seedMetricReading(property, {
      count: 4,
      at: new Date('2026-08-03T09:00:00.000Z'),
    })

    const progress = await harness.callAs(admin, () =>
      getGoalListProgress({ data: { propertyId: property.id } }),
    )

    expect(progress.goals).toEqual([
      expect.objectContaining({
        programId: goal.programId,
        subjectCount: 1,
        month: { reading: { kind: 'live', sampleCount: 4, value: 4 }, targetValue: 25 },
      }),
    ])
  })
})

describe('Goal Program refusals', () => {
  it('answers an unknown goal with not found', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        getGoalProgramHistory({
          data: { propertyId: property.id, programId: randomUUID() },
        }),
      ),
    ).rejects.toMatchObject({ name: 'GoalProgramError', code: 'not_found', status: 404 })
  })

  it.each([
    ['forbidden', 403],
    ['not_found', 404],
    ['revision_conflict', 409],
    ['month_locked', 409],
    ['invalid_target', 400],
    ['assignment_limit_exceeded', 400],
  ] as const)('answers %s with %i', async (code, status) => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        withGoalPrograms(async () => {
          throw new GoalProgramError(code)
        }),
      ),
    ).rejects.toMatchObject({ name: 'GoalProgramError', code, status })
  })
})
