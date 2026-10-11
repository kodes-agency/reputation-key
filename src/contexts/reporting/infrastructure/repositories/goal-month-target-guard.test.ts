import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import type { GoalMonthlyResult } from '../../application/ports/goal-program.repository'
import { METRIC_DEFINITION_IDS, METRIC_VERSION_IDS } from '../../domain/metric-registry'
import { seedLockedMonthTarget } from '../testing/goal-month-target-seed'
import { createGoalProgramRepository } from './goal-program.repository'

type Month = Readonly<{ start: Date; end: Date }>

type ProgramFixture = Readonly<{
  organizationId: string
  propertyId: string
  programId: string
  versionId: string
  assignmentId: string
}>

type MonthInput = Readonly<{
  /** Months from the current UTC month: 0 is the running month, -1 the last. */
  offset: number
  status?: 'open' | 'reconciling' | 'closed'
  targetValue?: number | null
}>

const MEASURES = {
  qualified_scans: {
    definitionId: METRIC_DEFINITION_IDS.qualifiedScan,
    versionId: METRIC_VERSION_IDS.qualifiedScanGoal,
    minimumSample: 0,
    target: 400,
  },
  portal_rating_average: {
    definitionId: METRIC_DEFINITION_IDS.portalRatingAverage,
    versionId: METRIC_VERSION_IDS.portalRatingAverageGoal,
    minimumSample: 10,
    target: 4.5,
  },
} as const

const LOCKED = {
  code: '55000',
  message: 'goal monthly result target is locked once its period ends',
}
const BREAKS_MEASURE_RULE = {
  code: '23514',
  message: 'goal monthly result target breaks its measure rule',
}

/**
 * The month target lock and its change log, as PostgreSQL enforces them.
 *
 * Monthly results cannot be deleted, so nothing here is committed: the fixture
 * and every statement run inside one held transaction that is rolled back. The
 * guard reads the database clock, so the months are placed around the real
 * current month instead of fixed dates.
 */
describe.sequential('Goal month target guard (integration)', () => {
  let held: HeldTransaction | undefined
  let client: HeldTransaction['client']
  let db: Database
  let scans: ProgramFixture
  let average: ProgramFixture
  /** A second Program on the Property of `scans`. */
  let sibling: ProgramFixture
  let otherTenant: ProgramFixture
  /** Monthly result ids, named for the state the guard sees them in. */
  let months: Readonly<{
    running: string
    runningAverage: string
    ended: string
    endedWithTarget: string
    reconciling: string
    closed: string
    otherTenantRunning: string
  }>

  /** One statement in a savepoint, so a refusal leaves the held transaction usable. */
  async function attempt(text: string, values: readonly unknown[] = []) {
    await client.query('SAVEPOINT attempt')
    try {
      const result = await client.query(text, [...values])
      await client.query('RELEASE SAVEPOINT attempt')
      return result
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT attempt')
      throw error
    }
  }

  async function month(offset: number): Promise<Month> {
    const result = await client.query<Month>(
      `SELECT
         (date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')
            + make_interval(months => $1::int)) AT TIME ZONE 'UTC' AS "start",
         (date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')
            + make_interval(months => $1::int + 1)) AT TIME ZONE 'UTC' AS "end"`,
      [offset],
    )
    return result.rows[0] as Month
  }

  /** A Program on a Property of its own, or on `propertyId` when one is given. */
  async function createProgram(
    organizationId: string,
    metric: keyof typeof MEASURES,
    propertyId?: string,
  ): Promise<ProgramFixture> {
    const measure = MEASURES[metric]
    const fixture: ProgramFixture = {
      organizationId,
      propertyId: propertyId ?? randomUUID(),
      programId: randomUUID(),
      versionId: randomUUID(),
      assignmentId: randomUUID(),
    }
    const effectiveFrom = (await month(-6)).start
    if (!propertyId) {
      await client.query(
        `INSERT INTO properties (id, organization_id, name, slug, timezone)
         VALUES ($1, $2, 'Month target Property', $3, 'UTC')`,
        [fixture.propertyId, organizationId, `month-target-${randomUUID()}`],
      )
    }
    await client.query(
      `INSERT INTO goal_programs
         (id, organization_id, property_id, name, status, current_version, created_by)
       VALUES ($1, $2, $3, 'Month target goal', 'active', 1, 'manager-1')`,
      [fixture.programId, organizationId, fixture.propertyId],
    )
    await client.query(
      `INSERT INTO goal_program_versions
         (id, program_id, organization_id, property_id, version,
          metric_definition_id, metric_definition_version_id, metric_key,
          metric_minimum_sample, target_value, property_timezone,
          effective_from, change_reason, created_by)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, 'UTC', $10, 'created', 'manager-1')`,
      [
        fixture.versionId,
        fixture.programId,
        organizationId,
        fixture.propertyId,
        measure.definitionId,
        measure.versionId,
        metric,
        measure.minimumSample,
        measure.target,
        effectiveFrom,
      ],
    )
    await client.query(
      `INSERT INTO goal_subject_assignments
         (id, program_id, program_version_id, organization_id, property_id,
          metric_key, subject_kind, property_subject_id, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'property', $5, $7, 'manager-1')`,
      [
        fixture.assignmentId,
        fixture.programId,
        fixture.versionId,
        organizationId,
        fixture.propertyId,
        metric,
        effectiveFrom,
      ],
    )
    return fixture
  }

  async function insertMonth(program: ProgramFixture, input: MonthInput) {
    const id = randomUUID()
    const period = await month(input.offset)
    const status = input.status ?? 'open'
    const closed = status === 'closed'
    await attempt(
      `INSERT INTO goal_monthly_results
         (id, assignment_id, program_id, program_version_id, organization_id,
          property_id, period_start, period_end, property_timezone, status,
          evaluation_state, value, sample_count, achieved,
          source_complete_through, evaluation_watermark, closed_at, target_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UTC', $9, $10, $11, $12, $13,
               $14, $15, $15, $16)`,
      [
        id,
        program.assignmentId,
        program.programId,
        program.versionId,
        program.organizationId,
        program.propertyId,
        period.start,
        period.end,
        status,
        closed ? 'eligible' : 'updating',
        closed ? 10 : null,
        closed ? 10 : 0,
        closed ? false : null,
        closed ? period.end : null,
        closed ? new Date() : null,
        input.targetValue ?? null,
      ],
    )
    return id
  }

  const setTarget = (resultId: string, targetValue: number | null) =>
    attempt(`UPDATE goal_monthly_results SET target_value = $2 WHERE id = $1`, [
      resultId,
      targetValue,
    ])

  async function storedTarget(resultId: string): Promise<string | null> {
    const result = await client.query<{ target_value: string | null }>(
      `SELECT target_value FROM goal_monthly_results WHERE id = $1`,
      [resultId],
    )
    return result.rows[0]?.target_value ?? null
  }

  async function logChange(
    program: ProgramFixture,
    monthlyResultId: string,
    overrides: Readonly<Record<string, unknown>> = {},
  ) {
    const row = {
      id: randomUUID(),
      organization_id: program.organizationId,
      property_id: program.propertyId,
      program_id: program.programId,
      monthly_result_id: monthlyResultId,
      change_id: randomUUID(),
      previous_target_value: 400,
      new_target_value: 300,
      following_outcome: 'not_requested',
      following_reason: null,
      following_version_id: null,
      note: null,
      created_by: 'manager-1',
      ...overrides,
    }
    const columns = Object.keys(row)
    return attempt(
      `INSERT INTO goal_month_target_changes (${columns.join(', ')})
       VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
      Object.values(row),
    )
  }

  beforeAll(async () => {
    held = await holdTransaction()
    client = held.client
    db = held.db
    const organizationId = `goal-month-target-${randomUUID()}`
    scans = await createProgram(organizationId, 'qualified_scans')
    average = await createProgram(organizationId, 'portal_rating_average')
    sibling = await createProgram(
      organizationId,
      'portal_rating_average',
      scans.propertyId,
    )
    otherTenant = await createProgram(
      `goal-month-target-other-${randomUUID()}`,
      'qualified_scans',
    )
    months = {
      running: await insertMonth(scans, { offset: 0 }),
      runningAverage: await insertMonth(average, { offset: 0 }),
      ended: await insertMonth(scans, { offset: -1 }),
      endedWithTarget: await insertMonth(average, { offset: -1 }),
      reconciling: await insertMonth(scans, { offset: -2, status: 'reconciling' }),
      closed: await insertMonth(scans, { offset: -3, status: 'closed' }),
      otherTenantRunning: await insertMonth(otherTenant, { offset: 0 }),
    }
    // Set while that month ran; the lock would refuse it now.
    await seedLockedMonthTarget(client, months.endedWithTarget, 4.2)
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  it('the guard accepts a change on the real current month', async () => {
    await expect(setTarget(months.running, 300)).resolves.toMatchObject({ rowCount: 1 })
    await expect(setTarget(months.runningAverage, 4.2)).resolves.toMatchObject({
      rowCount: 1,
    })
    // Changing it again, and taking it back off, are both allowed while it runs.
    await expect(setTarget(months.running, 350)).resolves.toMatchObject({ rowCount: 1 })
    await expect(setTarget(months.runningAverage, null)).resolves.toMatchObject({
      rowCount: 1,
    })

    // Read back the way maintenance reads a month that has just ended.
    const repository = createGoalProgramRepository(db)
    const dueAt = (await month(0)).end
    await expect(
      repository.getDueResult(
        scans.organizationId,
        scans.propertyId,
        months.running,
        dueAt,
      ),
    ).resolves.toMatchObject({ targetValue: 350 })
    await expect(
      repository.getDueResult(
        average.organizationId,
        average.propertyId,
        months.runningAverage,
        dueAt,
      ),
    ).resolves.toMatchObject({ targetValue: null })
    await expect(
      repository.getDueResult(
        average.organizationId,
        average.propertyId,
        months.endedWithTarget,
        dueAt,
      ),
    ).resolves.toMatchObject({ targetValue: 4.2 })
    // The version keeps the target the goal was set with.
    await expect(
      repository.getVersion(scans.organizationId, scans.propertyId, scans.versionId),
    ).resolves.toMatchObject({ targetValue: 400 })
  })

  it('the guard refuses a target change after the period end', async () => {
    await expect(setTarget(months.ended, 300)).rejects.toMatchObject(LOCKED)
    expect(await storedTarget(months.ended)).toBeNull()
  })

  it('a month’s own target cannot be taken off after the period end', async () => {
    await expect(setTarget(months.endedWithTarget, null)).rejects.toMatchObject(LOCKED)
    expect(Number(await storedTarget(months.endedWithTarget))).toBe(4.2)
  })

  it('the guard refuses a target change on a reconciling row', async () => {
    await expect(setTarget(months.reconciling, 300)).rejects.toMatchObject(LOCKED)
    expect(await storedTarget(months.reconciling)).toBeNull()
  })

  it('a closed row’s target cannot change', async () => {
    await expect(setTarget(months.closed, 300)).rejects.toMatchObject({
      code: '55000',
      message: 'closed goal monthly results are immutable; append a revision',
    })
    expect(await storedTarget(months.closed)).toBeNull()
  })

  it('the guard refuses 400.5 scans and an average of 7', async () => {
    for (const target of [400.5, 0, -1]) {
      await expect(
        setTarget(months.running, target),
        `${target} scans`,
      ).rejects.toMatchObject(BREAKS_MEASURE_RULE)
    }
    for (const target of [7, 0.9, 4.55]) {
      await expect(
        setTarget(months.runningAverage, target),
        `an average of ${target}`,
      ).rejects.toMatchObject(BREAKS_MEASURE_RULE)
    }
    await expect(setTarget(months.running, 401)).resolves.toMatchObject({ rowCount: 1 })
    await expect(setTarget(months.runningAverage, 5)).resolves.toMatchObject({
      rowCount: 1,
    })
  })

  it('the guard refuses a new month whose target breaks its measure rule', async () => {
    await expect(
      insertMonth(scans, { offset: 1, targetValue: 400.5 }),
    ).rejects.toMatchObject(BREAKS_MEASURE_RULE)
    await expect(
      insertMonth(average, { offset: 1, targetValue: 7 }),
    ).rejects.toMatchObject(BREAKS_MEASURE_RULE)
  })

  it('the guard refuses a new month that brings a target after its period end', async () => {
    await expect(
      insertMonth(scans, { offset: -4, targetValue: 300 }),
    ).rejects.toMatchObject(LOCKED)
    // The same month without a target of its own is still accepted.
    await expect(insertMonth(scans, { offset: -4 })).resolves.toEqual(expect.any(String))
  })

  it('the guard refuses a new reconciling or closed month that brings a target', async () => {
    for (const status of ['reconciling', 'closed'] as const) {
      await expect(
        insertMonth(sibling, { offset: -2, status, targetValue: 4.2 }),
        status,
      ).rejects.toMatchObject(LOCKED)
    }
  })

  it('the guard accepts a new month that brings a target while it is open and running', async () => {
    const running = await insertMonth(sibling, { offset: 0, targetValue: 4.2 })
    expect(Number(await storedTarget(running))).toBe(4.2)
  })

  it('a month with its own target still reconciles and closes', async () => {
    const ended = await insertMonth(scans, { offset: -5 })
    await seedLockedMonthTarget(client, ended, 300)

    await expect(
      attempt(`UPDATE goal_monthly_results SET status = 'reconciling' WHERE id = $1`, [
        ended,
      ]),
    ).resolves.toMatchObject({ rowCount: 1 })
    await expect(
      attempt(
        `UPDATE goal_monthly_results
         SET status = 'closed', evaluation_state = 'eligible', value = 320,
             sample_count = 320, achieved = true, reason = NULL,
             source_complete_through = period_end, evaluation_watermark = now(),
             closed_at = now()
         WHERE id = $1`,
        [ended],
      ),
    ).resolves.toMatchObject({ rowCount: 1 })
    expect(Number(await storedTarget(ended))).toBe(300)
  })

  it('opening a month through the repository never writes a target', async () => {
    const repository = createGoalProgramRepository(db)
    const version = await repository.getVersion(
      scans.organizationId,
      scans.propertyId,
      scans.versionId,
    )
    if (!version) throw new Error('The fixture version is missing')
    const period = await month(-6)
    const at = new Date()
    const opened: GoalMonthlyResult = {
      id: randomUUID(),
      assignmentId: scans.assignmentId,
      programId: scans.programId,
      programVersionId: scans.versionId,
      organizationId: scans.organizationId,
      propertyId: scans.propertyId,
      periodStart: period.start,
      periodEnd: period.end,
      propertyTimezone: 'UTC',
      status: 'open',
      targetValue: 999,
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
      createdAt: at,
      updatedAt: at,
    }

    await expect(
      repository.appendResults({
        program: {
          id: scans.programId,
          organizationId: scans.organizationId,
          propertyId: scans.propertyId,
          name: 'Month target goal',
          description: null,
          status: 'active',
          statusReason: null,
          currentVersion: version.version,
          createdBy: 'manager-1',
          createdAt: at,
          updatedAt: at,
        },
        version,
        results: [opened],
        at,
      }),
    ).resolves.toBe(1)
    expect(await storedTarget(opened.id)).toBeNull()
  })

  describe('change log', () => {
    it('records a change against its month, Program and following version', async () => {
      const changeId = randomUUID()
      await expect(
        logChange(scans, months.running, {
          change_id: changeId,
          note: 'Fewer guests in October',
          following_outcome: 'applied',
          following_version_id: scans.versionId,
        }),
      ).resolves.toMatchObject({ rowCount: 1 })
      // One command logs every month it changed under the same change id.
      await expect(
        logChange(scans, months.ended, { change_id: changeId }),
      ).resolves.toMatchObject({ rowCount: 1 })

      const stored = await client.query<{ created_at: Date | null }>(
        `SELECT created_at FROM goal_month_target_changes WHERE change_id = $1`,
        [changeId],
      )
      expect(stored.rows).toHaveLength(2)
      expect(stored.rows.every((row) => row.created_at instanceof Date)).toBe(true)
    })

    it('refuses a second row for the same month under one change', async () => {
      const changeId = randomUUID()
      await logChange(scans, months.running, { change_id: changeId })

      await expect(
        logChange(scans, months.running, {
          change_id: changeId,
          previous_target_value: 300,
          new_target_value: 350,
        }),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'goal_month_target_changes_change_result_key',
      })
      // A later change to the same month is a command of its own.
      await expect(
        logChange(scans, months.running, {
          previous_target_value: 300,
          new_target_value: 350,
        }),
      ).resolves.toMatchObject({ rowCount: 1 })
    })

    it('refuses a change whose month belongs to another Program of the same Property', async () => {
      await expect(logChange(sibling, months.running)).rejects.toMatchObject({
        code: '23503',
        constraint: 'goal_month_target_changes_result_fk',
      })
    })

    it('refuses a following version of another Program of the same Property', async () => {
      await expect(
        logChange(scans, months.running, {
          following_outcome: 'applied',
          following_version_id: sibling.versionId,
        }),
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'goal_month_target_changes_following_version_fk',
      })
    })

    it('refuses a change that names another tenant’s month, Program or version', async () => {
      await expect(logChange(scans, months.otherTenantRunning)).rejects.toMatchObject({
        code: '23503',
        constraint: 'goal_month_target_changes_result_fk',
      })
      // Neither the Program nor a month of it exists in this tenant, so either
      // key may be the one that answers.
      await expect(
        logChange(scans, months.running, { program_id: otherTenant.programId }),
      ).rejects.toMatchObject({
        code: '23503',
        constraint: expect.stringMatching(
          /^goal_month_target_changes_(?:program|result)_fk$/u,
        ),
      })
      await expect(
        logChange(scans, months.running, {
          following_version_id: otherTenant.versionId,
        }),
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'goal_month_target_changes_following_version_fk',
      })
      await expect(
        logChange(scans, months.running, {
          organization_id: otherTenant.organizationId,
        }),
      ).rejects.toMatchObject({ code: '23503' })
    })

    it('refuses an unknown outcome, a blank or overlong note and a change to nothing', async () => {
      await expect(
        logChange(scans, months.running, { following_outcome: 'ticked' }),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'goal_month_target_changes_outcome_check',
      })
      for (const note of ['   ', 'x'.repeat(501)]) {
        await expect(logChange(scans, months.running, { note })).rejects.toMatchObject({
          code: '23514',
          constraint: 'goal_month_target_changes_note_check',
        })
      }
      await expect(
        logChange(scans, months.running, { note: 'x'.repeat(500) }),
      ).resolves.toMatchObject({ rowCount: 1 })
      for (const values of [
        { previous_target_value: 400, new_target_value: 400 },
        { previous_target_value: 400, new_target_value: 0 },
      ]) {
        await expect(logChange(scans, months.running, values)).rejects.toMatchObject({
          code: '23514',
          constraint: 'goal_month_target_changes_value_check',
        })
      }
    })

    it('keeps the month while a change refers to it', async () => {
      await logChange(scans, months.running)
      // The guard refuses every DELETE; it is switched off here, as the
      // Organization purge does, so the foreign key is what answers.
      await client.query(
        `ALTER TABLE goal_monthly_results DISABLE TRIGGER goal_monthly_results_guard`,
      )
      try {
        await expect(
          attempt(`DELETE FROM goal_monthly_results WHERE id = $1`, [months.running]),
        ).rejects.toMatchObject({
          code: '23503',
          constraint: 'goal_month_target_changes_result_fk',
        })
      } finally {
        await client.query(
          `ALTER TABLE goal_monthly_results ENABLE TRIGGER goal_monthly_results_guard`,
        )
      }
    })
  })
})
