import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { calendarPeriodRange } from '#/shared/domain/period-range'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramRepository,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../../application/ports/goal-program.repository'
import type { GoalSubject } from '../../domain/goal-program'
import { METRIC_DEFINITION_IDS, METRIC_VERSION_IDS } from '../../domain/metric-registry'
import { createGoalProgramRepository } from './goal-program.repository'
import { hasPostgresErrorCode } from './goal-program.rows'

type Month = Readonly<{ start: Date; end: Date }>
type ChangeInput = Parameters<GoalProgramRepository['changeMonthTarget']>[0]

/** A Property of an organisation with one Portal Group: the two subjects of a goal. */
type Place = Readonly<{
  organizationId: string
  propertyId: string
  portalGroupId: string
}>

/**
 * Changing a running month's target, as PostgreSQL commits it.
 *
 * Monthly results cannot be deleted, so nothing here is committed: the fixture
 * and every statement run inside one held transaction that is rolled back, and
 * the repository's own transaction is a savepoint inside it. The guard reads
 * the database clock, so the running month is the real current month.
 */
describe.sequential('Goal month target repository (integration)', () => {
  let held: HeldTransaction | undefined
  let client: HeldTransaction['client']
  let db: Database
  let repository: GoalProgramRepository
  let organizationId: string
  let otherOrganizationId: string
  let now: Date
  let thisMonth: Month
  let lastMonth: Month
  let nextMonth: Month

  /**
   * Every goal gets a Property of its own: one subject carries one goal per
   * measure, so two goals here could not share the same Property and group.
   */
  async function createPlace(ownerOrganizationId: string): Promise<Place> {
    const created: Place = {
      organizationId: ownerOrganizationId,
      propertyId: randomUUID(),
      portalGroupId: randomUUID(),
    }
    await client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Month target Property', $3, 'UTC')`,
      [created.propertyId, created.organizationId, `month-target-${randomUUID()}`],
    )
    await client.query(
      `INSERT INTO portal_groups (id, organization_id, property_id, name)
       VALUES ($1, $2, $3, 'Front desk')`,
      [created.portalGroupId, created.organizationId, created.propertyId],
    )
    return created
  }

  const versionOf = (place: Place, programId: string): GoalProgramVersion => ({
    id: randomUUID(),
    programId,
    organizationId: place.organizationId,
    propertyId: place.propertyId,
    version: 1,
    metricDefinitionId: METRIC_DEFINITION_IDS.qualifiedScan,
    metricDefinitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
    metric: 'qualified_scans',
    metricMinimumSample: 0,
    targetValue: 400,
    propertyTimezone: 'UTC',
    effectiveFrom: lastMonth.start,
    effectiveTo: null,
    changeReason: 'created',
    createdBy: 'manager-1',
    createdAt: lastMonth.start,
  })

  const assignmentOf = (
    version: GoalProgramVersion,
    subject: GoalSubject,
  ): GoalSubjectAssignment => ({
    id: randomUUID(),
    programId: version.programId,
    programVersionId: version.id,
    organizationId: version.organizationId,
    propertyId: version.propertyId,
    metric: version.metric,
    subject,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: null,
    createdBy: 'manager-1',
    createdAt: version.createdAt,
  })

  const monthOf = (
    assignment: GoalSubjectAssignment,
    period: Month,
  ): GoalMonthlyResult => ({
    id: randomUUID(),
    assignmentId: assignment.id,
    programId: assignment.programId,
    programVersionId: assignment.programVersionId,
    organizationId: assignment.organizationId,
    propertyId: assignment.propertyId,
    periodStart: period.start,
    periodEnd: period.end,
    propertyTimezone: 'UTC',
    status: 'open',
    targetValue: null,
    evaluation: {
      state: 'updating',
      value: null,
      sampleCount: 0,
      achieved: null,
      reason: 'period_open',
    },
    sourceCompleteThrough: null,
    evaluationWatermark: null,
    closedAt: null,
    createdAt: period.start,
    updatedAt: period.start,
  })

  /**
   * An active goal of 400 scans for a new Property and its group, with one
   * open month per subject in each of `periods`.
   */
  async function createProgram(
    ownerOrganizationId: string,
    periods: readonly Month[],
  ): Promise<GoalProgramBundle> {
    const place = await createPlace(ownerOrganizationId)
    const programId = randomUUID()
    const version = versionOf(place, programId)
    const assignments = [
      assignmentOf(version, { kind: 'property', propertyId: place.propertyId }),
      assignmentOf(version, { kind: 'portal_group', portalGroupId: place.portalGroupId }),
    ]
    const bundle: GoalProgramBundle = {
      program: {
        id: programId,
        organizationId: place.organizationId,
        propertyId: place.propertyId,
        name: `Scans ${programId}`,
        description: null,
        status: 'active',
        statusReason: null,
        currentVersion: 1,
        createdBy: 'manager-1',
        createdAt: version.createdAt,
        updatedAt: version.createdAt,
      },
      version,
      versions: [version],
      assignments,
      results: periods.flatMap((period) =>
        assignments.map((assignment) => monthOf(assignment, period)),
      ),
    }
    await expect(
      repository.create({ bundle, auditAction: 'goal.program.created' }),
    ).resolves.toBe('created')
    return bundle
  }

  /** The version a change writes for the months after, on the same subjects. */
  function followingRevision(goal: GoalProgramBundle, targetValue: number) {
    const version: GoalProgramVersion = {
      ...goal.version,
      id: randomUUID(),
      version: goal.version.version + 1,
      targetValue,
      effectiveFrom: nextMonth.start,
      changeReason: 'target_changed',
      createdAt: now,
    }
    return {
      version,
      assignments: goal.assignments.map((known) => assignmentOf(version, known.subject)),
      supersedeRowlessHead: false,
    }
  }

  /** A change of every month of `goal` in `period` from 400 to 300, with nothing after. */
  function changeOf(
    goal: GoalProgramBundle,
    patch: Partial<ChangeInput> = {},
    period: Month = thisMonth,
  ): ChangeInput {
    return {
      organizationId: goal.program.organizationId,
      propertyId: goal.program.propertyId,
      programId: goal.program.id,
      expectedVersion: goal.version,
      changeId: randomUUID(),
      months: goal.results
        .filter((result) => result.periodStart.getTime() === period.start.getTime())
        .map((result) => ({
          monthlyResultId: result.id,
          changeRowId: randomUUID(),
          storedTargetValue: null,
          previousTargetValue: 400,
        })),
      targetValue: 300,
      storedTargetValue: 300,
      following: { outcome: 'not_requested', reason: null, revision: null },
      note: null,
      actorId: 'manager-1',
      at: now,
      ...patch,
    }
  }

  async function stateOf(goal: GoalProgramBundle) {
    const scope = [goal.program.organizationId, goal.program.propertyId, goal.program.id]
    const program = await client.query<{ current_version: number; updated_at: Date }>(
      `SELECT current_version, updated_at FROM goal_programs
       WHERE organization_id = $1 AND property_id = $2 AND id = $3`,
      scope,
    )
    const months = await client.query<{ target_value: string | null }>(
      `SELECT target_value FROM goal_monthly_results
       WHERE organization_id = $1 AND property_id = $2 AND program_id = $3
       ORDER BY period_start, id`,
      scope,
    )
    const versions = await client.query(
      `SELECT id FROM goal_program_versions
       WHERE organization_id = $1 AND property_id = $2 AND program_id = $3`,
      scope,
    )
    const logged = await client.query(
      `SELECT id FROM goal_month_target_changes
       WHERE organization_id = $1 AND property_id = $2 AND program_id = $3`,
      scope,
    )
    const audited = await client.query<{
      details: Record<string, unknown>
      user_id: string
    }>(
      `SELECT details, user_id FROM audit_logs
       WHERE organization_id = $1 AND resource_id = $2
         AND action = 'goal.month_target.changed'`,
      [goal.program.organizationId, goal.program.id],
    )
    return {
      currentVersion: program.rows[0]?.current_version,
      updatedAt: program.rows[0]?.updated_at,
      targets: months.rows.map((row) =>
        row.target_value === null ? null : Number(row.target_value),
      ),
      versionCount: versions.rowCount,
      logCount: logged.rowCount,
      audits: audited.rows,
    }
  }

  /** Nothing of a refused change is left behind. */
  async function expectUntouched(goal: GoalProgramBundle) {
    const state = await stateOf(goal)
    expect(state).toMatchObject({
      currentVersion: 1,
      updatedAt: goal.program.updatedAt,
      versionCount: 1,
      logCount: 0,
      audits: [],
    })
    expect(state.targets.every((target) => target === null)).toBe(true)
  }

  beforeAll(async () => {
    held = await holdTransaction()
    client = held.client
    db = held.db
    repository = createGoalProgramRepository(db)
    now = new Date()
    thisMonth = calendarPeriodRange(now, 'UTC', 'monthly')
    lastMonth = calendarPeriodRange(
      new Date(thisMonth.start.getTime() - 1),
      'UTC',
      'monthly',
    )
    nextMonth = calendarPeriodRange(thisMonth.end, 'UTC', 'monthly')
    organizationId = `goal-month-target-own-${randomUUID()}`
    otherOrganizationId = `goal-month-target-other-${randomUUID()}`
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  it('writes the month, its log, the following version and the audit row in one transaction', async () => {
    const goal = await createProgram(organizationId, [lastMonth, thisMonth])
    const revision = followingRevision(goal, 300)
    const input = changeOf(goal, {
      following: { outcome: 'applied', reason: null, revision },
      note: 'Fewer guests this month',
    })

    await expect(repository.changeMonthTarget(input)).resolves.toBe('changed')

    const state = await stateOf(goal)
    // Last month is not running: only this month's two rows take the target.
    expect(state.targets).toEqual([null, null, 300, 300])
    expect(state).toMatchObject({ currentVersion: 2, versionCount: 2, logCount: 2 })
    expect(state.updatedAt).toEqual(now)
    expect(state.audits).toEqual([
      {
        user_id: 'manager-1',
        details: {
          propertyId: goal.program.propertyId,
          changeId: input.changeId,
          programVersionId: goal.version.id,
          monthCount: 2,
          previousTargetValue: 400,
          targetValue: 300,
          followingOutcome: 'applied',
          followingVersionId: revision.version.id,
        },
      },
    ])

    const stored = await repository.get(
      organizationId,
      goal.program.propertyId,
      goal.program.id,
    )
    expect(stored?.version).toMatchObject({
      id: revision.version.id,
      targetValue: 300,
      effectiveFrom: nextMonth.start,
    })
    // The version in force keeps the target the goal was set with.
    expect(stored?.versions[0]).toMatchObject({
      id: goal.version.id,
      targetValue: 400,
      effectiveTo: nextMonth.start,
    })
    expect(
      stored?.results
        .filter((result) => result.periodStart.getTime() === thisMonth.start.getTime())
        .map((result) => [result.targetValue, result.updatedAt]),
    ).toEqual([
      [300, now],
      [300, now],
    ])
    expect(stored?.targetChanges).toHaveLength(2)
    expect(new Set(stored?.targetChanges?.map((change) => change.changeId))).toEqual(
      new Set([input.changeId]),
    )
    expect(stored?.targetChanges?.map((change) => change.monthlyResultId).sort()).toEqual(
      input.months.map((month) => month.monthlyResultId).sort(),
    )
    expect(stored?.targetChanges?.[0]).toEqual({
      id: expect.any(String),
      organizationId,
      propertyId: goal.program.propertyId,
      programId: goal.program.id,
      monthlyResultId: expect.any(String),
      changeId: input.changeId,
      previousTargetValue: 400,
      newTargetValue: 300,
      followingOutcome: 'applied',
      followingReason: null,
      followingVersionId: revision.version.id,
      note: 'Fewer guests this month',
      createdBy: 'manager-1',
      createdAt: now,
    })
  })

  it('a month put back on its version’s target stores none of its own, and both changes stay logged', async () => {
    const goal = await createProgram(organizationId, [thisMonth])
    await repository.changeMonthTarget(changeOf(goal))

    await expect(
      repository.changeMonthTarget(
        changeOf(goal, {
          months: goal.results.map((result) => ({
            monthlyResultId: result.id,
            changeRowId: randomUUID(),
            storedTargetValue: 300,
            previousTargetValue: 300,
          })),
          targetValue: 400,
          storedTargetValue: null,
          following: {
            outcome: 'not_applied',
            reason: 'subject_unavailable',
            revision: null,
          },
        }),
      ),
    ).resolves.toBe('changed')

    const state = await stateOf(goal)
    expect(state.targets).toEqual([null, null])
    expect(state).toMatchObject({ currentVersion: 1, versionCount: 1, logCount: 4 })
    // One audit row per command. They share the held transaction's timestamp,
    // so their order is not asserted.
    expect(state.audits).toHaveLength(2)
    expect(state.audits.map((audit) => audit.details)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ previousTargetValue: 400, targetValue: 300 }),
        expect.objectContaining({
          previousTargetValue: 300,
          targetValue: 400,
          followingOutcome: 'not_applied',
          followingReason: 'subject_unavailable',
        }),
      ]),
    )
  })

  describe('transaction atomicity', () => {
    it('a following version that cannot be written leaves the month, the log and the audit untouched', async () => {
      const goal = await createProgram(organizationId, [thisMonth])
      // Replacing the head is refused: months have opened under it.
      const revision = { ...followingRevision(goal, 300), supersedeRowlessHead: true }

      await expect(
        repository.changeMonthTarget(
          changeOf(goal, {
            following: { outcome: 'replaced_scheduled_change', reason: null, revision },
          }),
        ),
      ).resolves.toBe('revision_conflict')

      await expectUntouched(goal)
    })

    it('a log row that cannot be written rolls back the month and the version written before it', async () => {
      const first = await createProgram(organizationId, [thisMonth])
      const logged = changeOf(first)
      await repository.changeMonthTarget(logged)
      const goal = await createProgram(organizationId, [thisMonth])
      const input = changeOf(goal, {
        following: {
          outcome: 'applied',
          reason: null,
          revision: followingRevision(goal, 300),
        },
      })
      const takenId = logged.months[0]?.changeRowId ?? ''

      await expect(
        repository.changeMonthTarget({
          ...input,
          months: input.months.map((month) => ({ ...month, changeRowId: takenId })),
        }),
      ).rejects.toSatisfy((error) => hasPostgresErrorCode(error, '23505'))

      await expectUntouched(goal)
    })
  })

  describe('the lock', () => {
    it('a guard refusal is reported as month_locked', async () => {
      // The command's clock reads the middle of last month; the database's
      // has passed that month's end, and its guard is what answers.
      const goal = await createProgram(organizationId, [lastMonth])
      const midLastMonth = new Date(
        (lastMonth.start.getTime() + lastMonth.end.getTime()) / 2,
      )

      await expect(
        repository.changeMonthTarget(
          changeOf(
            goal,
            {
              at: midLastMonth,
              following: {
                outcome: 'applied',
                reason: null,
                revision: followingRevision(goal, 300),
              },
            },
            lastMonth,
          ),
        ),
      ).resolves.toBe('month_locked')

      await expectUntouched(goal)
    })

    it('a target the guard refuses for the measure is reported as month_locked too', async () => {
      const goal = await createProgram(organizationId, [thisMonth])

      await expect(
        repository.changeMonthTarget(
          changeOf(goal, { targetValue: 300.5, storedTargetValue: 300.5 }),
        ),
      ).resolves.toBe('month_locked')

      await expectUntouched(goal)
    })

    it('a month that has left the open state is month_locked', async () => {
      const goal = await createProgram(organizationId, [lastMonth, thisMonth])
      const ended = goal.results.filter(
        (result) => result.periodStart.getTime() === lastMonth.start.getTime(),
      )
      await client.query(
        `UPDATE goal_monthly_results SET status = 'reconciling' WHERE id = ANY($1::uuid[])`,
        [ended.map((result) => result.id)],
      )
      const midLastMonth = new Date(
        (lastMonth.start.getTime() + lastMonth.end.getTime()) / 2,
      )

      await expect(
        repository.changeMonthTarget(changeOf(goal, { at: midLastMonth }, lastMonth)),
      ).resolves.toBe('month_locked')

      expect(await stateOf(goal)).toMatchObject({ logCount: 0, audits: [] })
    })
  })

  describe('a goal that moved on since it was read', () => {
    it('refuses a head that is no longer the expected version', async () => {
      const goal = await createProgram(organizationId, [thisMonth])
      const stale = { ...goal.version, version: 7 }

      await expect(
        repository.changeMonthTarget(changeOf(goal, { expectedVersion: stale })),
      ).resolves.toBe('revision_conflict')

      await expectUntouched(goal)
    })

    it('refuses a month whose target changed since it was read', async () => {
      const goal = await createProgram(organizationId, [thisMonth])
      await repository.changeMonthTarget(changeOf(goal))

      // This command still believes the months store no target of their own.
      await expect(
        repository.changeMonthTarget(
          changeOf(goal, { targetValue: 250, storedTargetValue: 250 }),
        ),
      ).resolves.toBe('revision_conflict')

      const state = await stateOf(goal)
      expect(state.targets).toEqual([300, 300])
      expect(state).toMatchObject({ logCount: 2 })
      expect(state.audits).toHaveLength(1)
    })

    it('refuses when a running month is missing from the command', async () => {
      const goal = await createProgram(organizationId, [thisMonth])
      const input = changeOf(goal)

      await expect(
        repository.changeMonthTarget({ ...input, months: input.months.slice(0, 1) }),
      ).resolves.toBe('revision_conflict')

      await expectUntouched(goal)
    })

    it('refuses an ended Program, whose running month keeps its target', async () => {
      const goal = await createProgram(organizationId, [thisMonth])
      await repository.changeStatus({
        organizationId,
        propertyId: goal.program.propertyId,
        programId: goal.program.id,
        expectedStatus: 'active',
        status: 'ended',
        reason: null,
        actorId: 'manager-1',
        at: now,
      })

      await expect(repository.changeMonthTarget(changeOf(goal))).resolves.toBe(
        'revision_conflict',
      )

      expect(await stateOf(goal)).toMatchObject({ logCount: 0, audits: [] })
      expect((await stateOf(goal)).targets).toEqual([null, null])
    })
  })

  describe('reading the log', () => {
    it('get and list return a Program’s changes oldest first; the maintenance read carries none', async () => {
      const goal = await createProgram(organizationId, [thisMonth])
      const months = (storedTargetValue: number | null, previousTargetValue: number) =>
        goal.results.map((result) => ({
          monthlyResultId: result.id,
          changeRowId: randomUUID(),
          storedTargetValue,
          previousTargetValue,
        }))
      const earlier = new Date(now.getTime() - 60_000)
      await repository.changeMonthTarget(
        changeOf(goal, { at: earlier, months: months(null, 400) }),
      )
      await repository.changeMonthTarget(
        changeOf(goal, {
          months: months(300, 300),
          targetValue: 250,
          storedTargetValue: 250,
        }),
      )

      const read = await repository.get(
        organizationId,
        goal.program.propertyId,
        goal.program.id,
      )
      expect(
        read?.targetChanges?.map((change) => [
          change.previousTargetValue,
          change.newTargetValue,
          change.createdAt,
        ]),
      ).toEqual([
        [400, 300, earlier],
        [400, 300, earlier],
        [300, 250, now],
        [300, 250, now],
      ])
      const [listed] = await repository.list(organizationId, goal.program.propertyId)
      expect(listed?.targetChanges).toEqual(read?.targetChanges)

      // A Program with no change has an empty log, not a missing one.
      const quiet = await createProgram(organizationId, [thisMonth])
      const [listedQuiet] = await repository.list(
        organizationId,
        quiet.program.propertyId,
      )
      expect(listedQuiet?.targetChanges).toEqual([])

      const operational = await repository.listOperational()
      expect(
        operational.find((bundle) => bundle.program.id === goal.program.id),
      ).not.toHaveProperty('targetChanges')
    })
  })

  describe('tenant scope', () => {
    it('cross-tenant denial: another organisation cannot change this goal’s month', async () => {
      const goal = await createProgram(organizationId, [thisMonth])
      const elsewhere = await createProgram(otherOrganizationId, [thisMonth])

      // The other organisation names this Program under its own tenant.
      await expect(
        repository.changeMonthTarget(
          changeOf(goal, {
            organizationId: otherOrganizationId,
            propertyId: elsewhere.program.propertyId,
          }),
        ),
      ).resolves.toBe('revision_conflict')
      // So is the other organisation naming this goal's own Property.
      await expect(
        repository.changeMonthTarget(
          changeOf(goal, { organizationId: otherOrganizationId }),
        ),
      ).resolves.toBe('revision_conflict')
      // The right organisation with another Property is refused as well.
      await expect(
        repository.changeMonthTarget(
          changeOf(goal, { propertyId: elsewhere.program.propertyId }),
        ),
      ).resolves.toBe('revision_conflict')

      await expectUntouched(goal)
      await expectUntouched(elsewhere)
    })

    it('cross-tenant denial: a command on its own goal cannot reach another organisation’s month', async () => {
      const own = await createProgram(otherOrganizationId, [thisMonth])
      const foreign = await createProgram(organizationId, [thisMonth])

      await expect(
        repository.changeMonthTarget({
          ...changeOf(own),
          months: changeOf(foreign).months,
        }),
      ).resolves.toBe('month_locked')

      await expectUntouched(own)
      await expectUntouched(foreign)
    })

    // Last on purpose: it drops the log's foreign keys for the rest of the
    // held transaction, which rolls them back with everything else.
    it('a log row of another organisation with the same program id is not returned by get or list', async () => {
      const goal = await createProgram(organizationId, [thisMonth])
      const elsewhere = await createProgram(otherOrganizationId, [thisMonth])
      const own = changeOf(goal)
      await repository.changeMonthTarget(own)
      // Such a row cannot be written while the foreign keys stand. Without
      // them, three rows name this Program's id and month from outside its
      // organisation or its Property.
      await client.query(
        `ALTER TABLE goal_month_target_changes
           DROP CONSTRAINT goal_month_target_changes_program_fk,
           DROP CONSTRAINT goal_month_target_changes_result_fk,
           DROP CONSTRAINT goal_month_target_changes_following_version_fk`,
      )
      const strays = [
        [otherOrganizationId, elsewhere.program.propertyId],
        [otherOrganizationId, goal.program.propertyId],
        [organizationId, elsewhere.program.propertyId],
      ]
      for (const [strayOrganizationId, strayPropertyId] of strays) {
        await client.query(
          `INSERT INTO goal_month_target_changes
             (id, organization_id, property_id, program_id, monthly_result_id, change_id,
              previous_target_value, new_target_value, following_outcome, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, 999, 111, 'not_requested', 'someone-else')`,
          [
            randomUUID(),
            strayOrganizationId,
            strayPropertyId,
            goal.program.id,
            own.months[0]?.monthlyResultId,
            randomUUID(),
          ],
        )
      }

      const read = await repository.get(
        organizationId,
        goal.program.propertyId,
        goal.program.id,
      )
      const [listed] = await repository.list(organizationId, goal.program.propertyId)

      for (const bundle of [read, listed]) {
        expect(bundle?.targetChanges?.map((change) => change.createdBy)).toEqual([
          'manager-1',
          'manager-1',
        ])
        expect(bundle?.targetChanges?.map((change) => change.newTargetValue)).toEqual([
          300, 300,
        ])
      }
      // The Program is not readable under the other organisation at all, and
      // that organisation's own goal does not pick the stray rows up.
      await expect(
        repository.get(otherOrganizationId, goal.program.propertyId, goal.program.id),
      ).resolves.toBeNull()
      const [theirs] = await repository.list(
        otherOrganizationId,
        elsewhere.program.propertyId,
      )
      expect(theirs?.program.id).toBe(elsewhere.program.id)
      expect(theirs?.targetChanges).toEqual([])
    })
  })
})
