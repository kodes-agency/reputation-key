// The Monthly portal goal's change and Stop on PostgreSQL (ADR 0068, PLAN
// PG-14), through the engine's own commands: "now" changes the running month
// and the months after it, and still does on the month's last day (a month's
// number locks only once it has ended); "from next month" and "Count scans
// instead" write a version from the next month, and only from the month the
// sheet said; Stop keeps the running month, with its result, and frees the
// months after it, while a goal that has not started frees its month at once;
// a second Stop is refused.
//
// Monthly results cannot be deleted, so nothing here is committed: every
// statement runs in one held transaction that is rolled back. The month guard
// reads the database clock, so the running month is the real current month,
// on UTC.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { calendarPeriodRange } from '#/shared/domain/period-range'
import { findMetricVersionById } from '../domain/metric-registry'
import { monthKeyOf } from '../domain/goal-start'
import { monthlyPortalGoalOf } from '../application/monthly-portal-goal-identity'
import type { GoalProgramRepository } from '../application/ports/goal-program.repository'
import {
  createGoalProgramService,
  type GoalActor,
} from '../application/use-cases/goal-programs'
import {
  changeMonthlyPortalGoalNow,
  reviseMonthlyPortalGoal,
  setMonthlyPortalGoal,
  stopMonthlyPortalGoal,
  type MonthlyPortalGoalChangeDeps,
} from '../application/use-cases/monthly-portal-goal'
import { createGoalProgramRepository } from './repositories/goal-program.repository'

const TIMEZONE = 'UTC'
const HALF_AN_HOUR_MS = 30 * 60 * 1_000

describe.sequential('Monthly portal goal change and stop (integration)', () => {
  let held: HeldTransaction | undefined
  let repository: GoalProgramRepository
  let deps: MonthlyPortalGoalChangeDeps
  /** The engine: every command of the Program service. */
  let service: ReturnType<typeof createGoalProgramService>
  /** The commands' clock; the database's own is the real one. */
  let clock: Date
  let thisMonth: Readonly<{ start: Date; end: Date }>
  let thisKey: string
  let nextKey: string
  const organizationId = `monthly-portal-goal-change-${randomUUID()}`
  const actor: GoalActor = { organizationId, userId: 'elena', role: 'PropertyManager' }

  beforeAll(async () => {
    held = await holdTransaction()
    repository = createGoalProgramRepository(held.db)
    const realNow = new Date()
    thisMonth = calendarPeriodRange(realNow, TIMEZONE, 'monthly')
    thisKey = monthKeyOf(thisMonth.start, TIMEZONE)
    nextKey = monthKeyOf(
      calendarPeriodRange(thisMonth.end, TIMEZONE, 'monthly').start,
      TIMEZONE,
    )
    const now = () => clock
    const allow = { authorize: async () => undefined }
    service = createGoalProgramService({
      repository,
      policy: allow,
      subjects: {
        getTimezone: async () => TIMEZONE,
        subjectBelongsToProperty: async () => true,
        listCurrentPortalIds: async () => [],
      },
      metrics: {
        queryGoalMetric: async (query) => ({
          definitionVersionId: query.definitionVersionId,
          metricKey: null,
          state: 'eligible',
          exactValue: 0,
          sampleCount: 0,
          minimumSample: 0,
          sourceCompleteThrough: null,
          reason: null,
        }),
        getApprovedGoalVersion: async (versionId) => findMetricVersionById(versionId),
      },
      id: randomUUID,
      now,
    })
    deps = {
      policy: allow,
      repository,
      programs: service,
      recommendation: {
        subjects: { getTimezone: async () => TIMEZONE },
        facts: {
          listPortalReadiness: async () => ({ portals: [], truncated: false }),
          readDailyCounts: async () => ({
            days: [],
            unreadable: [],
            lastScanAt: new Map(),
          }),
        },
      },
      now,
    }
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  async function propertyFixture(): Promise<string> {
    const id = randomUUID()
    await held?.client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Seaview Hotel', $3, 'UTC')`,
      [id, organizationId, `monthly-portal-goal-change-${randomUUID()}`],
    )
    return id
  }

  /** The Monthly portal goal, set now: 40 private ratings from `startMonth`. */
  async function goalFrom(propertyId: string, startMonth: string) {
    clock = new Date()
    return setMonthlyPortalGoal(
      { ...deps, programs: service },
      {
        propertyId,
        metric: 'portal_rating_count',
        targetValue: 40,
        startMonth,
        targetSource: 'own',
      },
      actor,
    )
  }
  const stored = async (propertyId: string, programId: string) => {
    const bundle = await repository.get(organizationId, propertyId, programId)
    if (!bundle) throw new Error('expected the goal to be stored')
    return bundle
  }

  const nowChange = (propertyId: string, programId: string, targetValue: number) => ({
    propertyId,
    programId,
    month: thisKey,
    targetValue,
    expectedTarget: 40,
    expectedVersion: 1,
    expectedFollowingMonth: nextKey,
    targetSource: 'own' as const,
  })

  it('change now judges this month and the next against the new number', async () => {
    const propertyId = await propertyFixture()
    const { program } = await goalFrom(propertyId, thisKey)

    await changeMonthlyPortalGoalNow(deps, nowChange(propertyId, program.id, 45), actor)

    const goal = await stored(propertyId, program.id)
    expect(goal.results).toHaveLength(1)
    expect(goal.results[0]).toMatchObject({ status: 'open', targetValue: 45 })
    expect(goal.version).toMatchObject({
      version: 2,
      targetValue: 45,
      effectiveFrom: thisMonth.end,
      targetSource: 'own',
    })
  })

  it('the last day still changes now', async () => {
    const propertyId = await propertyFixture()
    const { program } = await goalFrom(propertyId, thisKey)
    clock = new Date(thisMonth.end.getTime() - HALF_AN_HOUR_MS)

    await changeMonthlyPortalGoalNow(deps, nowChange(propertyId, program.id, 30), actor)

    expect((await stored(propertyId, program.id)).results[0]).toMatchObject({
      status: 'open',
      targetValue: 30,
    })
  })

  it('From next month and Count scans instead revise from next month', async () => {
    const propertyId = await propertyFixture()
    const { program } = await goalFrom(propertyId, thisKey)

    await reviseMonthlyPortalGoal(
      deps,
      {
        propertyId,
        programId: program.id,
        metric: 'qualified_scans',
        targetValue: 55,
        expectedVersion: 1,
        startMonth: nextKey,
        note: 'Codes moved to the rooms',
        targetSource: 'own',
      },
      actor,
    )

    const goal = await stored(propertyId, program.id)
    // This month keeps counting private ratings against 40.
    expect(goal.results[0]).toMatchObject({ status: 'open', targetValue: null })
    expect(goal.versions[0]).toMatchObject({
      metric: 'portal_rating_count',
      targetValue: 40,
      effectiveTo: thisMonth.end,
    })
    expect(goal.version).toMatchObject({
      metric: 'qualified_scans',
      targetValue: 55,
      effectiveFrom: thisMonth.end,
      changeReason: 'Codes moved to the rooms',
    })
  })

  it('a revision for a month other than the one it would start with is refused', async () => {
    const propertyId = await propertyFixture()
    const { program } = await goalFrom(propertyId, thisKey)

    // A sheet read last month said "from this month"; this month has begun.
    await expect(
      reviseMonthlyPortalGoal(
        deps,
        {
          propertyId,
          programId: program.id,
          metric: 'portal_rating_count',
          targetValue: 45,
          expectedVersion: 1,
          startMonth: thisKey,
          targetSource: 'own',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'start_month_changed' })
    expect((await stored(propertyId, program.id)).versions).toHaveLength(1)
  })

  it('Stop keeps this month and frees the next', async () => {
    const propertyId = await propertyFixture()
    const { program } = await goalFrom(propertyId, thisKey)

    const ended = await stopMonthlyPortalGoal(
      deps,
      { propertyId, programId: program.id },
      actor,
    )

    expect(ended).toMatchObject({ status: 'ended', endedBy: 'elena' })
    const goal = await stored(propertyId, program.id)
    // The month keeps counting, to its last day, and keeps its result.
    expect(goal.results[0]).toMatchObject({ status: 'open' })
    expect(goal.assignments[0]?.effectiveTo).toEqual(thisMonth.end)
    expect(
      monthlyPortalGoalOf(await repository.list(organizationId, propertyId), clock)
        ?.program.id,
    ).toBe(program.id)
    // This month is still the stopped goal's; the next one is free.
    await expect(goalFrom(propertyId, thisKey)).rejects.toMatchObject({
      code: 'subject_has_goal',
    })
    await expect(goalFrom(propertyId, nextKey)).resolves.toMatchObject({
      program: { status: 'scheduled' },
    })
  })

  it('Stop on a scheduled goal frees the month at once', async () => {
    const propertyId = await propertyFixture()
    const { program } = await goalFrom(propertyId, nextKey)

    await stopMonthlyPortalGoal(deps, { propertyId, programId: program.id }, actor)

    // No month of it was counting: the card is the one before a goal again.
    expect(
      monthlyPortalGoalOf(await repository.list(organizationId, propertyId), clock),
    ).toBeNull()
    await expect(goalFrom(propertyId, nextKey)).resolves.toMatchObject({
      program: { status: 'scheduled' },
    })
  })

  it('a second Stop is invalid_transition', async () => {
    const propertyId = await propertyFixture()
    const { program } = await goalFrom(propertyId, thisKey)
    await stopMonthlyPortalGoal(deps, { propertyId, programId: program.id }, actor)

    await expect(
      stopMonthlyPortalGoal(deps, { propertyId, programId: program.id }, actor),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
  })
})
