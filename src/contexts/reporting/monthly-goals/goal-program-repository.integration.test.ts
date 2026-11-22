import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { METRIC_VERSION_IDS } from '../readings/contracts'
import type { GoalProgramVersion } from '../application/ports/goal-program.repository'
import { firstFullMonthlyPeriodAtOrAfter } from '../domain/goal-program'
import {
  goalAssignment,
  goalBundle,
  openMonth,
} from './goal-program-bundle.test-fixtures'
import { useGoalProgramRepositorySuite } from './goal-program-repository-suite.test-fixtures'

describe.sequential('Goal Program repository (integration)', () => {
  const suite = useGoalProgramRepositorySuite('goal-program-repo')

  it('creates and revises the aggregate atomically under temporal guards', async () => {
    const { organizationId, propertyId, repository: repositoryOf } = suite
    const repository = repositoryOf()
    const now = new Date('2026-01-15T12:00:00.000Z')
    const programId = randomUUID()
    const bundle = goalBundle({
      organizationId,
      propertyId,
      programId,
      status: 'scheduled',
      effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
      at: now,
    })
    const firstVersion = bundle.version
    const firstAssignment = bundle.assignments[0]!
    await repository.create({
      bundle,
      auditAction: 'goal.program.created',
    })

    // The read a page works from also carries the log of the goal's month
    // target changes: empty for a goal whose months kept their target.
    await expect(
      repository.getHistory(organizationId, propertyId, programId),
    ).resolves.toEqual({
      ...bundle,
      targetChanges: [],
    })
    await expect(
      repository.activate({
        bundle,
        results: [
          openMonth(
            firstAssignment,
            firstVersion.effectiveFrom,
            new Date('2026-03-01T00:00:00.000Z'),
            now,
          ),
        ],
        at: new Date('2026-02-01T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'active', statusReason: null })

    const nextAt = new Date('2026-02-20T12:00:00.000Z')
    const nextVersion: GoalProgramVersion = {
      ...firstVersion,
      id: randomUUID(),
      version: 2,
      targetValue: 40,
      effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
      changeReason: 'raise target next month',
      createdAt: nextAt,
    }
    const nextAssignment = goalAssignment(nextVersion)
    await expect(
      repository.revise({
        expectedVersion: firstVersion,
        version: nextVersion,
        assignments: [nextAssignment],
        supersedeRowlessHead: false,
        actorId: 'manager-1',
        at: nextAt,
      }),
    ).resolves.toBe(true)

    const revised = await repository.getHistory(organizationId, propertyId, programId)
    expect(revised).toMatchObject({
      program: { currentVersion: 2, status: 'active' },
      version: { id: nextVersion.id, targetValue: 40 },
    })
    expect(revised?.assignments).toHaveLength(2)
    expect(revised?.results).toHaveLength(1)
    expect(revised?.results[0]?.programVersionId).toBe(firstVersion.id)

    const marchResult = openMonth(
      nextAssignment,
      new Date('2026-03-01T00:00:00.000Z'),
      new Date('2026-04-01T00:00:00.000Z'),
      nextAt,
    )
    if (!revised) throw new Error('expected revised Goal Program')
    await expect(
      repository.appendResults({
        program: revised.program,
        version: revised.version,
        results: [marchResult],
        at: nextAt,
      }),
    ).resolves.toBe(1)
    await expect(
      repository.appendResults({
        program: revised.program,
        version: revised.version,
        results: [marchResult],
        at: nextAt,
      }),
    ).resolves.toBe(0)
    const temporal = await suite.pool.query<{
      version_to: Date
      assignment_to: Date
    }>(
      `SELECT version.effective_to AS version_to,
              assignment.effective_to AS assignment_to
       FROM goal_program_versions version
       JOIN goal_subject_assignments assignment
         ON assignment.program_version_id = version.id
       WHERE version.id = $1`,
      [firstVersion.id],
    )
    expect(temporal.rows[0]).toEqual({
      version_to: nextVersion.effectiveFrom,
      assignment_to: nextVersion.effectiveFrom,
    })

    await expect(
      suite.conflictsFor(propertyId, nextVersion.effectiveFrom, undefined, randomUUID()),
    ).resolves.toEqual([
      { subject: { kind: 'property', propertyId }, programId, effectiveTo: null },
    ])
    await expect(
      suite.conflictsFor(propertyId, nextVersion.effectiveFrom, undefined, programId),
    ).resolves.toEqual([])

    const staleVersion: GoalProgramVersion = {
      ...nextVersion,
      id: randomUUID(),
      version: 3,
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
      changeReason: 'stale writer must lose',
    }
    await expect(
      repository.revise({
        expectedVersion: firstVersion,
        version: staleVersion,
        assignments: [goalAssignment(staleVersion)],
        supersedeRowlessHead: false,
        actorId: 'manager-1',
        at: nextAt,
      }),
    ).resolves.toBe(false)
    await expect(suite.history(bundle)).resolves.toMatchObject({
      program: { currentVersion: 2 },
      version: { id: nextVersion.id },
    })
  })

  it('create and revise store where the number came from, and a version not told stores none', async () => {
    const repository = suite.repository()
    const targetPropertyId = await suite.createProperty('Number source Property')
    const at = new Date('2026-01-15T12:00:00.000Z')
    const created = suite.bundle({
      propertyId: targetPropertyId,
      status: 'scheduled',
      effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
      at,
    })
    const first: GoalProgramVersion = { ...created.version, targetSource: 'recommended' }
    await expect(
      repository.create({
        bundle: { ...created, version: first, versions: [first] },
        auditAction: 'goal.program.created',
      }),
    ).resolves.toBe('created')
    // Each revision replaces a head no month opened under.
    const reviseTo = async (
      expectedVersion: GoalProgramVersion,
      patch: Pick<GoalProgramVersion, 'targetValue' | 'targetSource'>,
    ): Promise<GoalProgramVersion> => {
      const version: GoalProgramVersion = {
        ...expectedVersion,
        ...patch,
        id: randomUUID(),
        version: expectedVersion.version + 1,
        changeReason: 'revised',
      }
      await expect(
        repository.revise({
          expectedVersion,
          version,
          assignments: [goalAssignment(version, { at })],
          supersedeRowlessHead: true,
          actorId: 'manager-1',
          at,
        }),
      ).resolves.toBe(true)
      return version
    }

    const second = await reviseTo(first, { targetValue: 30, targetSource: 'own' })
    await reviseTo(second, { targetValue: 35, targetSource: null })

    const stored = await suite.pool.query(
      `SELECT version, target_source FROM goal_program_versions
       WHERE organization_id = $1 AND property_id = $2 AND program_id = $3
       ORDER BY version`,
      [suite.organizationId, targetPropertyId, created.program.id],
    )
    expect(stored.rows).toEqual([
      { version: 1, target_source: 'recommended' },
      { version: 2, target_source: 'own' },
      { version: 3, target_source: null },
    ])
    const read = await suite.history(created)
    expect(read?.versions.map((version) => version.targetSource)).toEqual([
      'recommended',
      'own',
      undefined,
    ])
  })

  it('ending a goal records who and when', async () => {
    const periodStart = new Date('2026-01-01T00:00:00.000Z')
    const { targetPropertyId, bundle: original } = await suite.seed(
      'Ended record Property',
      {
        status: 'active',
        effectiveFrom: periodStart,
        at: periodStart,
        withOpenResult: { end: new Date('2026-02-01T00:00:00.000Z') },
      },
    )
    const endRecord = async () =>
      (
        await suite.pool.query(
          `SELECT status, ended_at, ended_by FROM goal_programs
           WHERE organization_id = $1 AND property_id = $2 AND id = $3`,
          [suite.organizationId, targetPropertyId, original.program.id],
        )
      ).rows
    const change = (
      expectedStatus: 'active' | 'paused',
      status: 'paused' | 'ended',
      actorId: string,
      at: Date,
    ) => suite.endGoal(original, { expectedStatus, status, reason: null, actorId, at })

    // Pausing ends nothing, so it records no end.
    await change('active', 'paused', 'manager-2', new Date('2026-01-10T08:00:00.000Z'))
    expect(await endRecord()).toEqual([
      { status: 'paused', ended_at: null, ended_by: null },
    ])
    const read = () => suite.history(original)
    // A read names no end for a goal that has not ended.
    expect((await read())?.program).not.toHaveProperty('endedAt')
    expect((await read())?.program).not.toHaveProperty('endedBy')

    const endedAt = new Date('2026-01-12T09:30:00.000Z')
    await expect(change('paused', 'ended', 'manager-3', endedAt)).resolves.toMatchObject({
      status: 'ended',
    })
    expect(await endRecord()).toEqual([
      { status: 'ended', ended_at: endedAt, ended_by: 'manager-3' },
    ])
    // The read the Monthly portal goal's card and page work from says when it
    // ended, and who ended it.
    expect((await read())?.program).toMatchObject({
      status: 'ended',
      endedAt,
      endedBy: 'manager-3',
    })
  })

  it('a kept check-in records its month alone, the same again when kept twice', async () => {
    const periodStart = new Date('2026-01-01T00:00:00.000Z')
    const {
      repository,
      targetPropertyId,
      bundle: original,
    } = await suite.seed('Check-in Property', {
      status: 'active',
      effectiveFrom: periodStart,
      at: periodStart,
      withOpenResult: { end: new Date('2026-02-01T00:00:00.000Z') },
    })
    const stored = async () =>
      (
        await suite.pool.query(
          `SELECT status, current_version, updated_at, check_in_answered_month
           FROM goal_programs
           WHERE organization_id = $1 AND property_id = $2 AND id = $3`,
          [suite.organizationId, targetPropertyId, original.program.id],
        )
      ).rows
    const keep = (month: string, programId = original.program.id) =>
      repository.answerCheckIn({
        organizationId: suite.organizationId,
        propertyId: targetPropertyId,
        programId,
        month,
      })
    const [before] = await stored()

    await expect(keep('2026-01')).resolves.toBe(true)
    await expect(keep('2026-01')).resolves.toBe(true)

    // No version, no status change, no new update time: only the answer.
    expect(await stored()).toEqual([
      {
        status: 'active',
        current_version: 1,
        updated_at: before?.updated_at,
        check_in_answered_month: '2026-01',
      },
    ])
    const read = await suite.history(original)
    expect(read?.program.checkInAnsweredMonth).toBe('2026-01')
    expect(read?.version.version).toBe(1)
    // Another Program, or another Organization's, is never answered.
    await expect(keep('2026-01', randomUUID())).resolves.toBe(false)
    await expect(
      repository.answerCheckIn({
        organizationId: `${suite.organizationId}-other`,
        propertyId: targetPropertyId,
        programId: original.program.id,
        month: '2026-02',
      }),
    ).resolves.toBe(false)
    expect((await stored())[0]?.check_in_answered_month).toBe('2026-01')
    // A goal that has ended takes no answer.
    await suite.endGoal(original, {
      expectedStatus: 'active',
      status: 'ended',
      reason: null,
      actorId: 'manager-2',
      at: new Date('2026-01-12T09:30:00.000Z'),
    })
    await expect(keep('2026-02')).resolves.toBe(false)
    expect((await stored())[0]?.check_in_answered_month).toBe('2026-01')
  })

  it('a goal never kept names no answered month', async () => {
    const periodStart = new Date('2026-01-01T00:00:00.000Z')
    const { bundle: original } = await suite.seed('Unanswered Property', {
      status: 'active',
      effectiveFrom: periodStart,
      at: periodStart,
      withOpenResult: { end: new Date('2026-02-01T00:00:00.000Z') },
    })

    const read = await suite.history(original)

    expect(read?.program).not.toHaveProperty('checkInAnsweredMonth')
  })

  it('finds only exact-version closed results inside the half-open impacted month', async () => {
    const periodStart = new Date('2026-07-01T00:00:00.000Z')
    const periodEnd = new Date('2026-08-01T00:00:00.000Z')
    const {
      repository,
      targetPropertyId,
      bundle: original,
    } = await suite.seed('Correction Goal Property', {
      status: 'active',
      effectiveFrom: periodStart,
      at: periodStart,
      withOpenResult: { end: periodEnd },
    })
    const monthlyResult = original.results[0]!
    await suite.pool.query(
      `UPDATE goal_monthly_results
          SET status = 'reconciling',
              updated_at = $2
        WHERE id = $1`,
      [monthlyResult.id, periodEnd],
    )
    await suite.pool.query(
      `UPDATE goal_monthly_results
          SET status = 'closed',
              evaluation_state = 'eligible',
              value = 1,
              sample_count = 1,
              achieved = false,
              reason = NULL,
              source_complete_through = $2,
              evaluation_watermark = $2,
              closed_at = $2,
              updated_at = $2
        WHERE id = $1`,
      [monthlyResult.id, periodEnd],
    )

    const impact = {
      organizationId: suite.organizationId,
      propertyId: targetPropertyId,
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      portalId: randomUUID(),
      portalGroupId: randomUUID(),
    }
    await expect(
      repository.findClosedResultIdsForMetricImpact({
        ...impact,
        eventAt: periodStart,
      }),
    ).resolves.toEqual([monthlyResult.id])
    await expect(
      repository.findClosedResultIdsForMetricImpact({
        ...impact,
        eventAt: new Date(periodEnd.getTime() - 1),
      }),
    ).resolves.toEqual([monthlyResult.id])
    await expect(
      repository.findClosedResultIdsForMetricImpact({
        ...impact,
        eventAt: periodEnd,
      }),
    ).resolves.toEqual([])
    await expect(
      repository.findClosedResultIdsForMetricImpact({
        ...impact,
        definitionVersionId: METRIC_VERSION_IDS.portalRatingAverageGoal,
        eventAt: periodStart,
      }),
    ).resolves.toEqual([])
  })

  // Havana's midnight on 1 November 2026 happens twice. The monthly-result
  // guard derives the month it accepts with `AT TIME ZONE`, so the months the
  // app computes must match PostgreSQL's reading of that midnight, or every
  // Havana Goal stops at October and maintenance fails each hour.
  it('accepts the Havana months the app derives across a repeated local midnight', async () => {
    const repository = suite.repository()
    const targetPropertyId = await suite.createProperty('Havana Goal Property')
    const timezone = 'America/Havana'
    const october = firstFullMonthlyPeriodAtOrAfter(
      new Date('2026-09-15T12:00:00.000Z'),
      timezone,
    )
    const november = firstFullMonthlyPeriodAtOrAfter(october.end, timezone)
    const original = suite.bundle({
      propertyId: targetPropertyId,
      status: 'active',
      effectiveFrom: october.start,
      at: october.start,
      withOpenResult: { end: october.end },
      timezone,
    })
    const subjectAssignment = original.assignments[0]!

    await expect(
      repository.create({ bundle: original, auditAction: 'goal.program.created' }),
    ).resolves.toBe('created')
    await expect(
      repository.appendResults({
        program: original.program,
        version: original.version,
        results: [
          openMonth(
            subjectAssignment,
            november.start,
            november.end,
            november.start,
            timezone,
          ),
        ],
        at: november.start,
      }),
    ).resolves.toBe(1)
  })

  // The revision boundary comes from a snapshot read before the transaction.
  // Maintenance can open the next month for the current version in between;
  // closing the version at that month's start would leave the month outside
  // its version window, where the guard refuses every later update to it.
  it('refuses a revision whose start falls inside a month opened after the snapshot', async () => {
    const february = {
      start: new Date('2026-02-01T00:00:00.000Z'),
      end: new Date('2026-03-01T00:00:00.000Z'),
    }
    const march = { start: february.end, end: new Date('2026-04-01T00:00:00.000Z') }
    const { repository, bundle: original } = await suite.seed('Racing Goal Property', {
      status: 'active',
      effectiveFrom: february.start,
      at: february.start,
      withOpenResult: { end: february.end },
    })
    const subjectAssignment = original.assignments[0]!
    // The revision below was computed before this month existed.
    await expect(
      repository.appendResults({
        program: original.program,
        version: original.version,
        results: [openMonth(subjectAssignment, march.start, march.end, march.start)],
        at: march.start,
      }),
    ).resolves.toBe(1)

    const revisionAt = new Date('2026-02-28T23:59:59.000Z')
    const revisedFrom = (effectiveFrom: Date): GoalProgramVersion => ({
      ...original.version,
      id: randomUUID(),
      version: 2,
      targetValue: 40,
      effectiveFrom,
      changeReason: 'raise target',
      createdAt: revisionAt,
    })
    const revise = (version: GoalProgramVersion) =>
      repository.revise({
        expectedVersion: original.version,
        version,
        assignments: [goalAssignment(version)],
        supersedeRowlessHead: false,
        actorId: 'manager-1',
        at: revisionAt,
      })

    await expect(revise(revisedFrom(march.start))).resolves.toBe(false)
    const unchanged = await suite.history(original)
    expect(unchanged).toMatchObject({
      program: { currentVersion: 1 },
      version: { id: original.version.id, effectiveTo: null },
    })
    expect(unchanged?.versions).toHaveLength(1)

    // Retried from a fresh read, the revision starts after the open month.
    await expect(revise(revisedFrom(march.end))).resolves.toBe(true)
  })

  describe('a Program changed in place', () => {
    const at = new Date('2026-01-15T12:00:00.000Z')
    const februaryStart = new Date('2026-02-01T00:00:00.000Z')

    const scheduledGoal = (label: string) =>
      suite.seed(label, { status: 'scheduled', effectiveFrom: februaryStart, at })

    const auditDetails = async (programId: string, action: string) => {
      const { rows } = await suite.pool.query<{
        property_id: string | null
        actor_id: string | null
        outcome: string
      }>(
        `SELECT property_id, actor_id, outcome FROM audit_events
          WHERE organization_id = $1 AND resource_id = $2 AND action = $3
          ORDER BY occurred_at`,
        [suite.organizationId, programId, action],
      )
      return rows
    }

    it('a status change without a note stores no status reason', async () => {
      const { targetPropertyId, bundle } = await scheduledGoal(
        'Unexplained Goal Property',
      )

      await expect(
        suite.endGoal(bundle, {
          expectedStatus: 'scheduled',
          status: 'ended',
          reason: null,
          at,
        }),
      ).resolves.toMatchObject({ status: 'ended', statusReason: null })
      await expect(
        auditDetails(bundle.program.id, 'goal.program.status_changed'),
      ).resolves.toEqual([
        { property_id: targetPropertyId, actor_id: 'manager-1', outcome: 'succeeded' },
      ])
    })

    // Ending needs exactly one open version to close. Without one the version
    // history changed under the command: a conflict to report, not a failure.
    it('reports an ending that finds no open version as a conflict and writes nothing', async () => {
      const { bundle } = await scheduledGoal('Conflicting End Property')
      await suite.pool.query(
        `UPDATE goal_program_versions SET effective_to = effective_from WHERE id = $1`,
        [bundle.version.id],
      )

      await expect(
        suite.endGoal(bundle, {
          expectedStatus: 'scheduled',
          status: 'ended',
          reason: 'Ended by manager',
          at,
        }),
      ).resolves.toBeNull()
      await expect(suite.history(bundle)).resolves.toMatchObject({
        program: { status: 'scheduled', statusReason: 'awaiting_first_full_month' },
      })
      await expect(
        auditDetails(bundle.program.id, 'goal.program.status_changed'),
      ).resolves.toEqual([])
    })
  })
})
