// The Monthly portal goal server functions, called as signed-in members over
// PostgreSQL with the real tenant resolution, execution policy (goal.use and the
// goal permissions on the Property) and Goal Program commands. The clock sits on
// the third day of the running calendar month: the month guard in the database
// compares with the real time, so the goal's month must be the real one.

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

import { goalStartOptions } from '../domain/goal-start'
import {
  addPortalGoal,
  addPortalGoals,
  changeMonthlyPortalGoalNow,
  deferMonthlyPortalGoalPrompt,
  getMonthlyPortalGoalCard,
  getMonthlyPortalGoalLine,
  getMonthlyPortalGoalPage,
  getPortalGoalAddOptions,
  getPortalGoalSinglePage,
  keepMonthlyPortalGoal,
  reviseMonthlyPortalGoal,
  setMonthlyPortalGoal,
  stopMonthlyPortalGoal,
} from './monthly-portal-goals'

const realNow = new Date()
const NOW = new Date(
  Date.UTC(realNow.getUTCFullYear(), realNow.getUTCMonth(), 3, 12, 0, 0),
)
const PROPERTY_TIMEZONE = 'UTC'

const harness = setupServerFunctionHarness({
  clock: () => NOW,
  cleanupTables: [
    'portal_goal_prompt_deferrals',
    ...GOAL_CLEANUP_TABLES,
    ...PORTAL_SEED_CLEANUP_TABLES,
  ],
  disabledTriggers: GOAL_CLEANUP_TRIGGERS,
})

const months = goalStartOptions(NOW, PROPERTY_TIMEZONE)
const THIS_MONTH = months.current.monthKey
const NEXT_MONTH = months.next.monthKey

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const member = await harness.seedMember(organization, 'Member')
  const property = await harness.seedProperty(organization, {
    timezone: PROPERTY_TIMEZONE,
  })
  return { organization, admin, manager, member, property }
}

type Hotel = Awaited<ReturnType<typeof hotel>>

const setOwn = (propertyId: string, targetValue = 40) => ({
  propertyId,
  metric: 'qualified_scans' as const,
  targetValue,
  startMonth: THIS_MONTH,
  targetSource: 'own' as const,
})

async function withGoal(): Promise<Hotel & { programId: string }> {
  const base = await hotel()
  const { programId } = await harness.callAs(base.admin, () =>
    setMonthlyPortalGoal({ data: setOwn(base.property.id) }),
  )
  return { ...base, programId }
}

async function programRows(propertyId: string) {
  const { rows } = await harness.pool().query<{
    id: string
    status: string
    current_version: number
  }>('SELECT id, status, current_version FROM goal_programs WHERE property_id = $1 ORDER BY created_at', [propertyId])
  return rows
}

describe('reading the card and the page', () => {
  it('shows an AccountAdmin no_portal while the Property has no Portal', async () => {
    const { admin, property } = await hotel()
    const data = { propertyId: property.id }

    await expect(
      harness.callAs(admin, () => getMonthlyPortalGoalCard({ data })),
    ).resolves.toMatchObject({ state: 'no_portal' })
    await expect(
      harness.callAs(admin, () => getMonthlyPortalGoalPage({ data })),
    ).resolves.toMatchObject({ card: { state: 'no_portal' } })
  })

  it('shows drafts_only while every Portal is a draft', async () => {
    const { admin, property } = await hotel()
    await harness.seedPortal(property)
    const data = { propertyId: property.id }

    const card = await harness.callAs(admin, () => getMonthlyPortalGoalCard({ data }))
    const page = await harness.callAs(admin, () => getMonthlyPortalGoalPage({ data }))

    expect(card).toMatchObject({ state: 'drafts_only' })
    expect(page).toMatchObject({ card: { state: 'drafts_only' } })
  })

  it('shows the goal once it is set', async () => {
    const { admin, property } = await withGoal()

    const card = await harness.callAs(admin, () =>
      getMonthlyPortalGoalCard({ data: { propertyId: property.id } }),
    )

    expect(card).toMatchObject({ state: 'goal' })
  })
})

describe('who may use the Monthly portal goal functions', () => {
  it('refuses a PropertyManager without a grant, and a Member, on every function', async () => {
    const { manager, member, property, programId } = await withGoal()
    const goal = { propertyId: property.id, programId }
    const data = { propertyId: property.id }
    const calls: Array<() => Promise<unknown>> = [
      () => getMonthlyPortalGoalCard({ data }),
      () => getMonthlyPortalGoalPage({ data }),
      () => setMonthlyPortalGoal({ data: setOwn(property.id) }),
      () => getPortalGoalAddOptions({ data }),
      () => stopMonthlyPortalGoal({ data: goal }),
      () => keepMonthlyPortalGoal({ data: { ...goal, month: THIS_MONTH } }),
      () => deferMonthlyPortalGoalPrompt({ data: { ...data, month: THIS_MONTH } }),
      () => getMonthlyPortalGoalLine({ data: { ...data, portalId: randomUUID() } }),
      () => getPortalGoalSinglePage({ data: goal }),
    ]

    for (const call of calls) {
      await expect(harness.callAs(manager, call)).rejects.toMatchObject({
        code: 'scope_denied',
        status: 403,
      })
      await expect(harness.callAs(member, call)).rejects.toMatchObject({
        code: 'beta_role_inactive',
        status: 403,
      })
    }
    expect(await programRows(property.id)).toHaveLength(1)
  })

  it('lets a granted PropertyManager read the card', async () => {
    const { manager, property } = await hotel()
    await harness.grantProperty(manager, property)

    await expect(
      harness.callAs(manager, () =>
        getMonthlyPortalGoalCard({ data: { propertyId: property.id } }),
      ),
    ).resolves.toMatchObject({ state: 'no_portal' })
  })

  it("refuses another Organization's Property and a request with no session", async () => {
    const { admin } = await hotel()
    const elsewhere = await hotel()
    const data = { propertyId: elsewhere.property.id }

    await expect(
      harness.callAs(admin, () =>
        setMonthlyPortalGoal({ data: setOwn(data.propertyId) }),
      ),
    ).rejects.toMatchObject({ status: expect.any(Number) })
    await expect(
      harness.callAs(null, () => getMonthlyPortalGoalCard({ data })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    expect(await programRows(elsewhere.property.id)).toEqual([])
  })
})

describe('setting the goal', () => {
  it('creates the Program, its version, subject and month, and returns its id', async () => {
    const { property, programId } = await withGoal()

    expect(await programRows(property.id)).toEqual([
      { id: programId, status: 'active', current_version: 1 },
    ])
    const { rows } = await harness.pool().query(
      `SELECT (SELECT count(*) FROM goal_program_versions WHERE program_id = $1) AS versions,
              (SELECT count(*) FROM goal_subject_assignments WHERE program_id = $1) AS subjects,
              (SELECT count(*) FROM goal_monthly_results WHERE program_id = $1) AS months`,
      [programId],
    )
    expect(rows[0]).toMatchObject({ versions: '1', subjects: '1' })
    expect(Number(rows[0].months)).toBeGreaterThan(0)
  })

  it('refuses a second goal for the Property with subject_has_goal', async () => {
    const { admin, property } = await withGoal()

    await expect(
      harness.callAs(admin, () =>
        setMonthlyPortalGoal({ data: setOwn(property.id, 55) }),
      ),
    ).rejects.toMatchObject({
      name: 'GoalProgramError',
      code: 'subject_has_goal',
      status: 409,
    })
    expect(await programRows(property.id)).toHaveLength(1)
  })

  it('refuses a start month that is no longer offered with start_month_changed', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        setMonthlyPortalGoal({ data: { ...setOwn(property.id), startMonth: '2019-01' } }),
      ),
    ).rejects.toMatchObject({ code: 'start_month_changed', status: 409 })
    expect(await programRows(property.id)).toEqual([])
  })

  it('refuses an average, which is no count to aim for', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        setMonthlyPortalGoal({
          data: { ...setOwn(property.id), metric: 'portal_rating_average' as never },
        }),
      ),
    ).rejects.toThrow(/metric/)
    expect(await programRows(property.id)).toEqual([])
  })
})

describe('changing and stopping the goal', () => {
  it('stops the goal and refuses a second stop', async () => {
    const { admin, property, programId } = await withGoal()
    const goal = { propertyId: property.id, programId }

    await expect(
      harness.callAs(admin, () => stopMonthlyPortalGoal({ data: goal })),
    ).resolves.toEqual({ programId })
    expect(await programRows(property.id)).toEqual([
      { id: programId, status: 'ended', current_version: 1 },
    ])
    await expect(
      harness.callAs(admin, () => stopMonthlyPortalGoal({ data: goal })),
    ).rejects.toMatchObject({ code: 'invalid_transition', status: 409 })
  })

  it("changes the running month's number now and says it changed", async () => {
    const { admin, property, programId } = await withGoal()

    await expect(
      harness.callAs(admin, () =>
        changeMonthlyPortalGoalNow({
          data: {
            propertyId: property.id,
            programId,
            month: THIS_MONTH,
            targetValue: 60,
            expectedTarget: 40,
            expectedVersion: 1,
            expectedFollowingMonth: NEXT_MONTH,
            targetSource: 'own',
          },
        }),
      ),
    ).resolves.toEqual({ changed: true })
    const { rows } = await harness
      .pool()
      .query('SELECT count(*) FROM goal_month_target_changes WHERE program_id = $1', [
        programId,
      ])
    expect(Number(rows[0].count)).toBeGreaterThan(0)
  })

  it('refuses a change made against a number the sheet no longer shows', async () => {
    const { admin, property, programId } = await withGoal()

    await expect(
      harness.callAs(admin, () =>
        changeMonthlyPortalGoalNow({
          data: {
            propertyId: property.id,
            programId,
            month: THIS_MONTH,
            targetValue: 60,
            expectedTarget: 99,
            expectedVersion: 1,
            expectedFollowingMonth: NEXT_MONTH,
            targetSource: 'own',
          },
        }),
      ),
    ).rejects.toMatchObject({ name: 'GoalProgramError', status: 409 })
  })

  it('revises the goal from the next month and counts scans instead', async () => {
    const { admin, property, programId } = await withGoal()

    await expect(
      harness.callAs(admin, () =>
        reviseMonthlyPortalGoal({
          data: {
            propertyId: property.id,
            programId,
            metric: 'qualified_scans',
            targetValue: 55,
            expectedVersion: 1,
            startMonth: NEXT_MONTH,
            targetSource: 'own',
          },
        }),
      ),
    ).resolves.toEqual({ programId })
    expect((await programRows(property.id))[0]).toMatchObject({ current_version: 2 })
  })

  it('refuses a revision made against an old version with revision_conflict', async () => {
    const { admin, property, programId } = await withGoal()

    await expect(
      harness.callAs(admin, () =>
        reviseMonthlyPortalGoal({
          data: {
            propertyId: property.id,
            programId,
            metric: 'qualified_scans',
            targetValue: 55,
            expectedVersion: 7,
            startMonth: NEXT_MONTH,
            targetSource: 'own',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict', status: 409 })
  })

  it('answers an unknown goal with not_found, 404, on every command and the page', async () => {
    const { admin, property } = await hotel()
    const goal = { propertyId: property.id, programId: randomUUID() }
    const calls: Array<() => Promise<unknown>> = [
      () => getPortalGoalSinglePage({ data: goal }),
      () => stopMonthlyPortalGoal({ data: goal }),
      () =>
        changeMonthlyPortalGoalNow({
          data: {
            ...goal,
            month: THIS_MONTH,
            targetValue: 60,
            expectedTarget: 40,
            expectedVersion: 1,
            expectedFollowingMonth: NEXT_MONTH,
            targetSource: 'own',
          },
        }),
      () =>
        reviseMonthlyPortalGoal({
          data: {
            ...goal,
            metric: 'qualified_scans',
            targetValue: 55,
            expectedVersion: 1,
            startMonth: NEXT_MONTH,
            targetSource: 'own',
          },
        }),
      () => keepMonthlyPortalGoal({ data: { ...goal, month: THIS_MONTH } }),
    ]

    for (const call of calls) {
      await expect(harness.callAs(admin, call)).rejects.toMatchObject({
        name: 'GoalProgramError',
        code: expect.stringMatching(/^(not_found|invalid_subject)$/),
      })
    }
  })
})

describe("the month-start check-in's Keep", () => {
  it('answers the check-in without a new version', async () => {
    const { admin, property, programId } = await withGoal()

    await expect(
      harness.callAs(admin, () =>
        keepMonthlyPortalGoal({
          data: { propertyId: property.id, programId, month: THIS_MONTH },
        }),
      ),
    ).resolves.toEqual({ month: THIS_MONTH })
    expect((await programRows(property.id))[0]).toMatchObject({ current_version: 1 })
  })

  it('refuses a month the check-in did not ask about with check_in_closed', async () => {
    const { admin, property, programId } = await withGoal()

    await expect(
      harness.callAs(admin, () =>
        keepMonthlyPortalGoal({
          data: { propertyId: property.id, programId, month: NEXT_MONTH },
        }),
      ),
    ).rejects.toMatchObject({ code: 'check_in_closed', status: 409 })
  })
})

describe("the Overview prompt's Not now", () => {
  it('stores the deferral and returns its month', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        deferMonthlyPortalGoalPrompt({
          data: { propertyId: property.id, month: THIS_MONTH },
        }),
      ),
    ).resolves.toEqual({ month: THIS_MONTH })
    const { rows } = await harness
      .pool()
      .query('SELECT month FROM portal_goal_prompt_deferrals WHERE property_id = $1', [
        property.id,
      ])
    expect(rows).toHaveLength(1)
  })

  it('refuses a month no prompt names with start_month_changed', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        deferMonthlyPortalGoalPrompt({
          data: { propertyId: property.id, month: '2099-01' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'start_month_changed', status: 409 })
  })
})

describe("a Portal's Results line", () => {
  it('is null for a Portal with no goal', async () => {
    const { admin, property } = await hotel()
    const portal = await harness.seedPortal(property)

    await expect(
      harness.callAs(admin, () =>
        getMonthlyPortalGoalLine({
          data: { propertyId: property.id, portalId: portal.id },
        }),
      ),
    ).resolves.toBeNull()
  })

  it("shows the Portal's own goal on its line", async () => {
    const { admin, property } = await hotel()
    const portal = await harness.seedPublishedPortal(property)
    const own = await harness.callAs(admin, () =>
      addPortalGoal({
        data: {
          propertyId: property.id,
          subject: { kind: 'portal', portalId: portal.id },
          metric: 'qualified_scans',
          targetValue: 22,
          startMonth: THIS_MONTH,
          targetSource: 'own',
        },
      }),
    )

    const line = await harness.callAs(admin, () =>
      getMonthlyPortalGoalLine({
        data: { propertyId: property.id, portalId: portal.id },
      }),
    )

    expect(line).toMatchObject({ ownGoal: expect.objectContaining({ target: 22 }) })
    expect(JSON.stringify(line)).toContain(own.programId)
  })
})

describe('Add a portal goal', () => {
  it('lists what it offers', async () => {
    const { admin, property } = await hotel()
    await harness.seedPortal(property)

    await expect(
      harness.callAs(admin, () =>
        getPortalGoalAddOptions({ data: { propertyId: property.id } }),
      ),
    ).resolves.toBeDefined()
  })

  it('adds one goal for a Portal and refuses a second for the same Portal', async () => {
    const { admin, property } = await hotel()
    const portal = await harness.seedPortal(property)
    const data = {
      propertyId: property.id,
      subject: { kind: 'portal' as const, portalId: portal.id },
      metric: 'qualified_scans' as const,
      targetValue: 22,
      startMonth: THIS_MONTH,
      targetSource: 'own' as const,
    }

    const added = await harness.callAs(admin, () => addPortalGoal({ data }))
    expect(await programRows(property.id)).toEqual([
      { id: added.programId, status: 'active', current_version: 1 },
    ])
    await expect(
      harness.callAs(admin, () => addPortalGoal({ data })),
    ).rejects.toMatchObject({ code: 'subject_has_goal', status: 409 })
  })

  it('refuses a Portal of another Property with invalid_subject', async () => {
    const { admin, property, organization } = await hotel()
    const elsewhere = await harness.seedProperty(organization, {
      timezone: PROPERTY_TIMEZONE,
    })
    const portal = await harness.seedPortal(elsewhere)

    await expect(
      harness.callAs(admin, () =>
        addPortalGoal({
          data: {
            propertyId: property.id,
            subject: { kind: 'portal', portalId: portal.id },
            metric: 'qualified_scans',
            targetValue: 22,
            startMonth: THIS_MONTH,
            targetSource: 'own',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_subject', status: 400 })
    expect(await programRows(property.id)).toEqual([])
  })

  it('adds a goal for each ticked Portal with a row outcome each', async () => {
    const { admin, property } = await hotel()
    const first = await harness.seedPortal(property)
    const second = await harness.seedPortal(property)

    const result = await harness.callAs(admin, () =>
      addPortalGoals({
        data: {
          propertyId: property.id,
          metric: 'qualified_scans',
          startMonth: THIS_MONTH,
          items: [first, second].map((portal) => ({
            portalId: portal.id,
            targetValue: 22,
            targetSource: 'own' as const,
          })),
        },
      }),
    )

    expect(result.outcomes).toHaveLength(2)
    expect(await programRows(property.id)).toHaveLength(2)
  })

  it('refuses a start month that is no longer offered', async () => {
    const { admin, property } = await hotel()
    const portal = await harness.seedPortal(property)

    await expect(
      harness.callAs(admin, () =>
        addPortalGoal({
          data: {
            propertyId: property.id,
            subject: { kind: 'portal', portalId: portal.id },
            metric: 'qualified_scans',
            targetValue: 22,
            startMonth: '2019-01',
            targetSource: 'own',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'start_month_changed', status: 409 })
  })
})
