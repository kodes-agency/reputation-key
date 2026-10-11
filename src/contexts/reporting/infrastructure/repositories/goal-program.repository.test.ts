import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import {
  findMetricVersionById,
  METRIC_DEFINITION_IDS,
  METRIC_VERSION_IDS,
} from '../../domain/metric-registry'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../../application/ports/goal-program.repository'
import {
  createGoalProgramService,
  type GoalActor,
} from '../../application/use-cases/goal-programs'
import { firstFullMonthlyPeriodAtOrAfter } from '../../domain/goal-program'
import { createGoalProgramRepository } from './goal-program.repository'

describe.sequential('Goal Program repository (integration)', () => {
  let lease: TestLease
  let organizationId: string
  let propertyId: string
  let metricDefinitionId: string

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    organizationId = `goal-program-repo-${randomUUID()}`
    propertyId = randomUUID()
    metricDefinitionId = METRIC_DEFINITION_IDS.portalRatingCount
    await lease.pool.query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Goal Repository Property', $3, 'UTC')`,
      [propertyId, organizationId, `goal-repository-${randomUUID()}`],
    )
  })

  afterAll(async () => {
    await lease?.release()
  })

  const assignment = (
    programId: string,
    programVersionId: string,
    effectiveFrom: Date,
    at: Date,
    targetPropertyId = propertyId,
  ): GoalSubjectAssignment => ({
    id: randomUUID(),
    programId,
    programVersionId,
    organizationId,
    propertyId: targetPropertyId,
    metric: 'portal_rating_count',
    subject: { kind: 'property', propertyId: targetPropertyId },
    effectiveFrom,
    effectiveTo: null,
    createdBy: 'manager-1',
    createdAt: at,
  })

  const result = (
    subjectAssignment: GoalSubjectAssignment,
    start: Date,
    end: Date,
    at: Date,
    timezone = 'UTC',
  ): GoalMonthlyResult => ({
    id: randomUUID(),
    assignmentId: subjectAssignment.id,
    programId: subjectAssignment.programId,
    programVersionId: subjectAssignment.programVersionId,
    organizationId,
    propertyId: subjectAssignment.propertyId,
    periodStart: start,
    periodEnd: end,
    propertyTimezone: timezone,
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
    createdAt: at,
    updatedAt: at,
  })

  async function createPropertyFixture(label: string): Promise<string> {
    const id = randomUUID()
    await lease.pool.query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, $3, $4, 'UTC')`,
      [id, organizationId, label, `goal-${randomUUID()}`],
    )
    return id
  }

  function programBundle(
    input: Readonly<{
      propertyId: string
      status: 'scheduled' | 'active'
      effectiveFrom: Date
      at: Date
      withOpenResult?: Readonly<{ end: Date }>
      timezone?: string
    }>,
  ): GoalProgramBundle {
    const timezone = input.timezone ?? 'UTC'
    const programId = randomUUID()
    const version: GoalProgramVersion = {
      id: randomUUID(),
      programId,
      organizationId,
      propertyId: input.propertyId,
      version: 1,
      metricDefinitionId,
      metricDefinitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metric: 'portal_rating_count',
      metricMinimumSample: 0,
      targetValue: 25,
      propertyTimezone: timezone,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      changeReason: 'created',
      createdBy: 'manager-1',
      createdAt: input.at,
    }
    const subjectAssignment = assignment(
      programId,
      version.id,
      input.effectiveFrom,
      input.at,
      input.propertyId,
    )
    return {
      program: {
        id: programId,
        organizationId,
        propertyId: input.propertyId,
        name: `Goal ${programId}`,
        description: null,
        status: input.status,
        statusReason: input.status === 'scheduled' ? 'awaiting_first_full_month' : null,
        currentVersion: 1,
        createdBy: 'manager-1',
        createdAt: input.at,
        updatedAt: input.at,
      },
      version,
      versions: [version],
      assignments: [subjectAssignment],
      results: input.withOpenResult
        ? [
            result(
              subjectAssignment,
              input.effectiveFrom,
              input.withOpenResult.end,
              input.at,
              timezone,
            ),
          ]
        : [],
    }
  }

  it('creates and revises the aggregate atomically under temporal guards', async () => {
    const repository = createGoalProgramRepository(getDb())
    const now = new Date('2026-01-15T12:00:00.000Z')
    const programId = randomUUID()
    const firstVersionId = randomUUID()
    const firstVersion: GoalProgramVersion = {
      id: firstVersionId,
      programId,
      organizationId,
      propertyId,
      version: 1,
      metricDefinitionId,
      metricDefinitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metric: 'portal_rating_count',
      metricMinimumSample: 0,
      targetValue: 25,
      propertyTimezone: 'UTC',
      effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
      effectiveTo: null,
      changeReason: 'created',
      createdBy: 'manager-1',
      createdAt: now,
    }
    const firstAssignment = assignment(
      programId,
      firstVersionId,
      firstVersion.effectiveFrom,
      now,
    )
    const bundle: GoalProgramBundle = {
      program: {
        id: programId,
        organizationId,
        propertyId,
        name: 'Monthly ratings',
        description: null,
        status: 'scheduled',
        statusReason: 'awaiting_first_full_month',
        currentVersion: 1,
        createdBy: 'manager-1',
        createdAt: now,
        updatedAt: now,
      },
      version: firstVersion,
      versions: [firstVersion],
      assignments: [firstAssignment],
      results: [],
    }
    await repository.create({
      bundle,
      auditAction: 'goal.program.created',
    })

    await expect(repository.get(organizationId, propertyId, programId)).resolves.toEqual(
      bundle,
    )
    await expect(
      repository.activate({
        bundle,
        results: [
          result(
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
    const nextAssignment = assignment(
      programId,
      nextVersion.id,
      nextVersion.effectiveFrom,
      nextAt,
    )
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

    const revised = await repository.get(organizationId, propertyId, programId)
    expect(revised).toMatchObject({
      program: { currentVersion: 2, status: 'active' },
      version: { id: nextVersion.id, targetValue: 40 },
    })
    expect(revised?.assignments).toHaveLength(2)
    expect(revised?.results).toHaveLength(1)
    expect(revised?.results[0]?.programVersionId).toBe(firstVersion.id)

    const marchResult = result(
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
    const temporal = await lease.pool.query<{
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
      repository.findAssignmentConflicts({
        organizationId,
        propertyId,
        excludeProgramId: randomUUID(),
        metric: 'portal_rating_count',
        effectiveFrom: nextVersion.effectiveFrom,
        subjects: [{ kind: 'property', propertyId }],
      }),
    ).resolves.toEqual([
      { subject: { kind: 'property', propertyId }, programId, effectiveTo: null },
    ])
    await expect(
      repository.findAssignmentConflicts({
        organizationId,
        propertyId,
        excludeProgramId: programId,
        metric: 'portal_rating_count',
        effectiveFrom: nextVersion.effectiveFrom,
        subjects: [{ kind: 'property', propertyId }],
      }),
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
        assignments: [
          assignment(programId, staleVersion.id, staleVersion.effectiveFrom, nextAt),
        ],
        supersedeRowlessHead: false,
        actorId: 'manager-1',
        at: nextAt,
      }),
    ).resolves.toBe(false)
    await expect(
      repository.get(organizationId, propertyId, programId),
    ).resolves.toMatchObject({
      program: { currentVersion: 2 },
      version: { id: nextVersion.id },
    })
  })

  it('ends a scheduled Program as an empty interval and releases its subject', async () => {
    const repository = createGoalProgramRepository(getDb())
    const targetPropertyId = await createPropertyFixture('Scheduled Goal Property')
    const at = new Date('2026-01-15T12:00:00.000Z')
    const effectiveFrom = new Date('2026-02-01T00:00:00.000Z')
    const original = programBundle({
      propertyId: targetPropertyId,
      status: 'scheduled',
      effectiveFrom,
      at,
    })
    await repository.create({
      bundle: original,
      auditAction: 'goal.program.created',
    })

    await expect(
      repository.changeStatus({
        organizationId,
        propertyId: targetPropertyId,
        programId: original.program.id,
        expectedStatus: 'scheduled',
        status: 'ended',
        reason: 'cancelled before start',
        actorId: 'manager-1',
        at: new Date('2026-01-20T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'ended' })

    const ended = await repository.get(
      organizationId,
      targetPropertyId,
      original.program.id,
    )
    expect(ended?.version.effectiveTo).toEqual(effectiveFrom)
    expect(ended?.assignments[0]?.effectiveTo).toEqual(effectiveFrom)

    const replacement = programBundle({
      propertyId: targetPropertyId,
      status: 'scheduled',
      effectiveFrom,
      at: new Date('2026-01-21T12:00:00.000Z'),
    })
    await expect(
      repository.create({
        bundle: replacement,
        auditAction: 'goal.program.created',
      }),
    ).resolves.toBe('created')
  })

  // A goal ended before its start keeps the empty window [start, start). The
  // no-overlap constraint ignores an empty range, so the pre-check must too:
  // counting it refused a goal the database would have accepted.
  it('a goal cancelled before its start does not block a this-month goal for the same subject and metric', async () => {
    const repository = createGoalProgramRepository(getDb())
    const targetPropertyId = await createPropertyFixture('Cancelled Goal Property')
    const january = {
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-02-01T00:00:00.000Z'),
    }
    const cancelled = programBundle({
      propertyId: targetPropertyId,
      status: 'scheduled',
      effectiveFrom: january.end,
      at: new Date('2026-01-15T12:00:00.000Z'),
    })
    await repository.create({ bundle: cancelled, auditAction: 'goal.program.created' })
    await expect(
      repository.changeStatus({
        organizationId,
        propertyId: targetPropertyId,
        programId: cancelled.program.id,
        expectedStatus: 'scheduled',
        status: 'ended',
        reason: 'cancelled before start',
        actorId: 'manager-1',
        at: new Date('2026-01-20T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'ended' })

    const subjects = [{ kind: 'property', propertyId: targetPropertyId }] as const
    await expect(
      repository.findAssignmentConflicts({
        organizationId,
        propertyId: targetPropertyId,
        metric: 'portal_rating_count',
        effectiveFrom: january.start,
        subjects,
      }),
    ).resolves.toEqual([])

    // Set on the 21st for January: active from the 1st, with January open.
    const thisMonth = programBundle({
      propertyId: targetPropertyId,
      status: 'active',
      effectiveFrom: january.start,
      at: new Date('2026-01-21T12:00:00.000Z'),
      withOpenResult: { end: january.end },
    })
    await expect(
      repository.create({ bundle: thisMonth, auditAction: 'goal.program.created' }),
    ).resolves.toBe('created')
    await expect(
      repository.get(organizationId, targetPropertyId, thisMonth.program.id),
    ).resolves.toMatchObject({
      program: { status: 'active' },
      version: { effectiveFrom: january.start, effectiveTo: null },
      results: [{ periodStart: january.start, periodEnd: january.end, status: 'open' }],
    })
    // The live goal now holds the subject, and the pre-check says which one.
    await expect(
      repository.findAssignmentConflicts({
        organizationId,
        propertyId: targetPropertyId,
        metric: 'portal_rating_count',
        effectiveFrom: january.start,
        subjects,
      }),
    ).resolves.toEqual([
      { subject: subjects[0], programId: thisMonth.program.id, effectiveTo: null },
    ])
  })

  // Ending a started goal holds its subject until the open month ends. A
  // replacement for that same month overlaps it; the write is refused as a
  // conflict the caller can report, and leaves nothing behind.
  it('a same-month replacement after ending a started goal returns a conflict, not a 500', async () => {
    const repository = createGoalProgramRepository(getDb())
    const targetPropertyId = await createPropertyFixture('Replaced Goal Property')
    const january = {
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-02-01T00:00:00.000Z'),
    }
    const started = programBundle({
      propertyId: targetPropertyId,
      status: 'active',
      effectiveFrom: january.start,
      at: january.start,
      withOpenResult: { end: january.end },
    })
    await repository.create({ bundle: started, auditAction: 'goal.program.created' })
    await expect(
      repository.changeStatus({
        organizationId,
        propertyId: targetPropertyId,
        programId: started.program.id,
        expectedStatus: 'active',
        status: 'ended',
        reason: 'wrong target',
        actorId: 'manager-1',
        at: new Date('2026-01-15T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'ended' })

    const subjects = [{ kind: 'property', propertyId: targetPropertyId }] as const
    await expect(
      repository.findAssignmentConflicts({
        organizationId,
        propertyId: targetPropertyId,
        metric: 'portal_rating_count',
        effectiveFrom: january.start,
        subjects,
      }),
    ).resolves.toEqual([
      { subject: subjects[0], programId: started.program.id, effectiveTo: january.end },
    ])

    const sameMonth = programBundle({
      propertyId: targetPropertyId,
      status: 'active',
      effectiveFrom: january.start,
      at: new Date('2026-01-16T12:00:00.000Z'),
      withOpenResult: { end: january.end },
    })
    await expect(
      repository.create({ bundle: sameMonth, auditAction: 'goal.program.created' }),
    ).resolves.toBe('subject_has_goal')
    await expect(
      repository.get(organizationId, targetPropertyId, sameMonth.program.id),
    ).resolves.toBeNull()

    // From February the subject is free again.
    await expect(
      repository.findAssignmentConflicts({
        organizationId,
        propertyId: targetPropertyId,
        metric: 'portal_rating_count',
        effectiveFrom: january.end,
        subjects,
      }),
    ).resolves.toEqual([])
    const nextMonth = programBundle({
      propertyId: targetPropertyId,
      status: 'scheduled',
      effectiveFrom: january.end,
      at: new Date('2026-01-16T12:00:00.000Z'),
    })
    await expect(
      repository.create({ bundle: nextMonth, auditAction: 'goal.program.created' }),
    ).resolves.toBe('created')
  })

  it('keeps an open month inside the interval when an active Program ends', async () => {
    const repository = createGoalProgramRepository(getDb())
    const targetPropertyId = await createPropertyFixture('Active Goal Property')
    const periodStart = new Date('2026-01-01T00:00:00.000Z')
    const periodEnd = new Date('2026-02-01T00:00:00.000Z')
    const original = programBundle({
      propertyId: targetPropertyId,
      status: 'active',
      effectiveFrom: periodStart,
      at: periodStart,
      withOpenResult: { end: periodEnd },
    })
    await repository.create({
      bundle: original,
      auditAction: 'goal.program.created',
    })

    await expect(
      repository.changeStatus({
        organizationId,
        propertyId: targetPropertyId,
        programId: original.program.id,
        expectedStatus: 'active',
        status: 'ended',
        reason: 'stop after current month',
        actorId: 'manager-1',
        at: new Date('2026-01-15T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'ended' })

    const ended = await repository.get(
      organizationId,
      targetPropertyId,
      original.program.id,
    )
    expect(ended?.version.effectiveTo).toEqual(periodEnd)
    expect(ended?.assignments[0]?.effectiveTo).toEqual(periodEnd)
    expect(ended?.results[0]?.periodEnd).toEqual(periodEnd)

    const replacement = programBundle({
      propertyId: targetPropertyId,
      status: 'scheduled',
      effectiveFrom: periodEnd,
      at: new Date('2026-01-16T12:00:00.000Z'),
    })
    await expect(
      repository.create({
        bundle: replacement,
        auditAction: 'goal.program.created',
      }),
    ).resolves.toBe('created')
  })

  it('finds only exact-version closed results inside the half-open impacted month', async () => {
    const repository = createGoalProgramRepository(getDb())
    const targetPropertyId = await createPropertyFixture('Correction Goal Property')
    const periodStart = new Date('2026-07-01T00:00:00.000Z')
    const periodEnd = new Date('2026-08-01T00:00:00.000Z')
    const original = programBundle({
      propertyId: targetPropertyId,
      status: 'active',
      effectiveFrom: periodStart,
      at: periodStart,
      withOpenResult: { end: periodEnd },
    })
    const monthlyResult = original.results[0]!
    await repository.create({
      bundle: original,
      auditAction: 'goal.program.created',
    })
    await lease.pool.query(
      `UPDATE goal_monthly_results
          SET status = 'reconciling',
              updated_at = $2
        WHERE id = $1`,
      [monthlyResult.id, periodEnd],
    )
    await lease.pool.query(
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
      organizationId,
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
    const repository = createGoalProgramRepository(getDb())
    const targetPropertyId = await createPropertyFixture('Havana Goal Property')
    const timezone = 'America/Havana'
    const october = firstFullMonthlyPeriodAtOrAfter(
      new Date('2026-09-15T12:00:00.000Z'),
      timezone,
    )
    const november = firstFullMonthlyPeriodAtOrAfter(october.end, timezone)
    const original = programBundle({
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
          result(
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
    const repository = createGoalProgramRepository(getDb())
    const targetPropertyId = await createPropertyFixture('Racing Goal Property')
    const february = {
      start: new Date('2026-02-01T00:00:00.000Z'),
      end: new Date('2026-03-01T00:00:00.000Z'),
    }
    const march = { start: february.end, end: new Date('2026-04-01T00:00:00.000Z') }
    const original = programBundle({
      propertyId: targetPropertyId,
      status: 'active',
      effectiveFrom: february.start,
      at: february.start,
      withOpenResult: { end: february.end },
    })
    const subjectAssignment = original.assignments[0]!
    await repository.create({ bundle: original, auditAction: 'goal.program.created' })
    // The revision below was computed before this month existed.
    await expect(
      repository.appendResults({
        program: original.program,
        version: original.version,
        results: [result(subjectAssignment, march.start, march.end, march.start)],
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
        assignments: [
          assignment(
            original.program.id,
            version.id,
            version.effectiveFrom,
            revisionAt,
            targetPropertyId,
          ),
        ],
        supersedeRowlessHead: false,
        actorId: 'manager-1',
        at: revisionAt,
      })

    await expect(revise(revisedFrom(march.start))).resolves.toBe(false)
    const unchanged = await repository.get(
      organizationId,
      targetPropertyId,
      original.program.id,
    )
    expect(unchanged).toMatchObject({
      program: { currentVersion: 1 },
      version: { id: original.version.id, effectiveTo: null },
    })
    expect(unchanged?.versions).toHaveLength(1)

    // Retried from a fresh read, the revision starts after the open month.
    await expect(revise(revisedFrom(march.end))).resolves.toBe(true)
  })

  // A head with no month (a goal that has not started, or a change still
  // waiting for its month) is replaced by the next change. The replaced version
  // and its assignments keep the empty window [from, from).
  describe('replacing a head that has no month', () => {
    const january = {
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-02-01T00:00:00.000Z'),
    }
    const february = {
      start: january.end,
      end: new Date('2026-03-01T00:00:00.000Z'),
    }
    const march = { start: february.end, end: new Date('2026-04-01T00:00:00.000Z') }
    const plannedAt = new Date('2026-01-15T12:00:00.000Z')
    const editedAt = new Date('2026-01-20T12:00:00.000Z')

    /** A goal set mid-January for February: scheduled, with no month yet. */
    async function scheduledForFebruary(label: string) {
      const repository = createGoalProgramRepository(getDb())
      const targetPropertyId = await createPropertyFixture(label)
      const bundle = programBundle({
        propertyId: targetPropertyId,
        status: 'scheduled',
        effectiveFrom: february.start,
        at: plannedAt,
      })
      await repository.create({ bundle, auditAction: 'goal.program.created' })
      return { repository, targetPropertyId, bundle }
    }

    /** The next version of a Program, for its Property as the one subject. */
    function following(
      previous: GoalProgramVersion,
      effectiveFrom: Date,
      targetValue: number,
    ) {
      const version: GoalProgramVersion = {
        ...previous,
        id: randomUUID(),
        version: previous.version + 1,
        targetValue,
        effectiveFrom,
        effectiveTo: null,
        changeReason: 'revised',
        createdAt: editedAt,
      }
      const subjectAssignment = assignment(
        previous.programId,
        version.id,
        effectiveFrom,
        editedAt,
        previous.propertyId,
      )
      return { version, assignments: [subjectAssignment] }
    }

    /** Each version's window, and each assignment's, by version number. */
    const windowsOf = (bundle: GoalProgramBundle | null) => {
      const numberOf = (versionId: string) =>
        bundle?.versions.find(({ id }) => id === versionId)?.version ?? 0
      return {
        versions: bundle?.versions.map((version) => [
          version.version,
          version.effectiveFrom,
          version.effectiveTo,
        ]),
        assignments: bundle?.assignments
          .map((subjectAssignment) => ({
            version: numberOf(subjectAssignment.programVersionId),
            window: subjectAssignment,
          }))
          .sort((left, right) => left.version - right.version)
          .map(({ version, window }) => [
            version,
            window.effectiveFrom,
            window.effectiveTo,
          ]),
      }
    }

    it('superseding a rowless head leaves an empty version window and no overlap', async () => {
      const { repository, targetPropertyId, bundle } = await scheduledForFebruary(
        'Superseded Goal Property',
      )
      const second = following(bundle.version, february.start, 40)
      await expect(
        repository.revise({
          expectedVersion: bundle.version,
          ...second,
          supersedeRowlessHead: true,
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(true)
      // A second change replaces the first one the same way, even when it
      // starts a month later (the Property changed time zone, say): the
      // replaced plan never covered the month in between.
      const third = following(second.version, march.start, 55)
      await expect(
        repository.revise({
          expectedVersion: second.version,
          ...third,
          supersedeRowlessHead: true,
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(true)

      const replaced = await repository.get(
        organizationId,
        targetPropertyId,
        bundle.program.id,
      )
      expect(replaced).toMatchObject({
        program: { status: 'scheduled', currentVersion: 3 },
        version: { id: third.version.id, targetValue: 55 },
        results: [],
      })
      // Two versions and two assignments of one subject share one start; the
      // empty windows overlap nothing, so both no-overlap constraints hold.
      expect(windowsOf(replaced)).toEqual({
        versions: [
          [1, february.start, february.start],
          [2, february.start, february.start],
          [3, march.start, null],
        ],
        assignments: [
          [1, february.start, february.start],
          [2, february.start, february.start],
          [3, march.start, null],
        ],
      })
    })

    it('replaces a change still waiting for its month and leaves the version in force alone', async () => {
      const repository = createGoalProgramRepository(getDb())
      const targetPropertyId = await createPropertyFixture('Pending Change Property')
      const running = programBundle({
        propertyId: targetPropertyId,
        status: 'active',
        effectiveFrom: january.start,
        at: january.start,
        withOpenResult: { end: january.end },
      })
      await repository.create({ bundle: running, auditAction: 'goal.program.created' })
      const pending = following(running.version, february.start, 40)
      await expect(
        repository.revise({
          expectedVersion: running.version,
          ...pending,
          supersedeRowlessHead: false,
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(true)

      const replacement = following(pending.version, february.start, 55)
      await expect(
        repository.revise({
          expectedVersion: pending.version,
          ...replacement,
          supersedeRowlessHead: true,
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(true)

      const replaced = await repository.get(
        organizationId,
        targetPropertyId,
        running.program.id,
      )
      expect(windowsOf(replaced).versions).toEqual([
        [1, january.start, january.end],
        [2, february.start, february.start],
        [3, february.start, null],
      ])
      // January stays open under the version it opened with.
      expect(replaced?.results).toMatchObject([
        { programVersionId: running.version.id, status: 'open' },
      ])
    })

    it('refuses to replace a head that has a month, and changes nothing', async () => {
      const repository = createGoalProgramRepository(getDb())
      const targetPropertyId = await createPropertyFixture('Started Goal Property')
      const running = programBundle({
        propertyId: targetPropertyId,
        status: 'active',
        effectiveFrom: january.start,
        at: january.start,
        withOpenResult: { end: january.end },
      })
      await repository.create({ bundle: running, auditAction: 'goal.program.created' })

      await expect(
        repository.revise({
          expectedVersion: running.version,
          ...following(running.version, february.start, 40),
          supersedeRowlessHead: true,
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(false)
      await expect(
        repository.get(organizationId, targetPropertyId, running.program.id),
      ).resolves.toMatchObject({
        program: { currentVersion: 1 },
        version: { id: running.version.id, effectiveTo: null },
        versions: [{ id: running.version.id }],
      })
    })

    it('a superseded assignment does not block another goal for that subject', async () => {
      const { repository, targetPropertyId, bundle } = await scheduledForFebruary(
        'Released Subject Property',
      )
      const portalId = randomUUID()
      await lease.pool.query(
        `INSERT INTO portals
           (id, organization_id, property_id, entity_type, entity_id, name, slug)
         VALUES ($1, $2, $3, 'property', $5, 'Lobby QR', $4)`,
        [
          portalId,
          organizationId,
          targetPropertyId,
          `lobby-${randomUUID()}`,
          targetPropertyId,
        ],
      )
      // The change moves the goal from the whole Property to one Portal.
      const moved = following(bundle.version, february.start, 25)
      await expect(
        repository.revise({
          expectedVersion: bundle.version,
          version: moved.version,
          assignments: moved.assignments.map((subjectAssignment) => ({
            ...subjectAssignment,
            subject: { kind: 'portal', portalId },
          })),
          supersedeRowlessHead: true,
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(true)

      // The Property subject is free from February, as if never planned.
      await expect(
        repository.findAssignmentConflicts({
          organizationId,
          propertyId: targetPropertyId,
          metric: 'portal_rating_count',
          effectiveFrom: february.start,
          subjects: [{ kind: 'property', propertyId: targetPropertyId }],
        }),
      ).resolves.toEqual([])
      const other = programBundle({
        propertyId: targetPropertyId,
        status: 'scheduled',
        effectiveFrom: february.start,
        at: editedAt,
      })
      await expect(
        repository.create({ bundle: other, auditAction: 'goal.program.created' }),
      ).resolves.toBe('created')
      // The Portal the goal moved to is held, by the new head.
      await expect(
        repository.findAssignmentConflicts({
          organizationId,
          propertyId: targetPropertyId,
          metric: 'portal_rating_count',
          effectiveFrom: february.start,
          subjects: [{ kind: 'portal', portalId }],
        }),
      ).resolves.toEqual([
        {
          subject: { kind: 'portal', portalId },
          programId: bundle.program.id,
          effectiveTo: null,
        },
      ])
    })

    it('activation after a supersede activates the new head', async () => {
      const { repository, targetPropertyId, bundle } = await scheduledForFebruary(
        'Activated Head Property',
      )
      const second = following(bundle.version, february.start, 40)
      await repository.revise({
        expectedVersion: bundle.version,
        ...second,
        supersedeRowlessHead: true,
        actorId: 'manager-1',
        at: editedAt,
      })
      const current = await repository.get(
        organizationId,
        targetPropertyId,
        bundle.program.id,
      )
      if (!current) throw new Error('expected the superseded Goal Program')

      await expect(
        repository.activate({
          bundle: current,
          results: [
            result(second.assignments[0]!, february.start, february.end, february.start),
          ],
          at: february.start,
        }),
      ).resolves.toMatchObject({ status: 'active', currentVersion: 2 })
      await expect(
        repository.get(organizationId, targetPropertyId, bundle.program.id),
      ).resolves.toMatchObject({
        program: { status: 'active' },
        version: { id: second.version.id, targetValue: 40 },
        results: [
          {
            programVersionId: second.version.id,
            periodStart: february.start,
            status: 'open',
          },
        ],
      })
    })

    it('a stale activation after a supersede changes nothing', async () => {
      const { repository, targetPropertyId, bundle } = await scheduledForFebruary(
        'Stale Activation Property',
      )
      // Maintenance read the goal, then the manager replaced its plan.
      await repository.revise({
        expectedVersion: bundle.version,
        ...following(bundle.version, february.start, 40),
        supersedeRowlessHead: true,
        actorId: 'manager-1',
        at: editedAt,
      })

      await expect(
        repository.activate({
          bundle,
          results: [
            result(bundle.assignments[0]!, february.start, february.end, february.start),
          ],
          at: february.start,
        }),
      ).resolves.toBeNull()
      await expect(
        repository.get(organizationId, targetPropertyId, bundle.program.id),
      ).resolves.toMatchObject({
        program: { status: 'scheduled', currentVersion: 2 },
        results: [],
      })
    })

    it('maintenance activates a program whose history holds an empty version', async () => {
      const repository = createGoalProgramRepository(getDb())
      const targetPropertyId = await createPropertyFixture('Maintained Goal Property')
      const clock = { now: plannedAt }
      const actor: GoalActor = {
        organizationId,
        userId: 'manager-1',
        role: 'PropertyManager',
      }
      const service = createGoalProgramService({
        // Maintenance discovers Programs across tenants. This case narrows
        // discovery to its own Property; every read and write is PostgreSQL's.
        repository: {
          ...repository,
          listOperational: async () =>
            (await repository.listOperational()).filter(
              ({ program }) => program.propertyId === targetPropertyId,
            ),
          listDueResults: async () => [],
        },
        policy: { authorize: async () => undefined },
        subjects: {
          getTimezone: async () => 'UTC',
          subjectBelongsToProperty: async () => true,
          listCurrentPortalIds: async () => [],
        },
        metrics: {
          queryGoalMetric: async (query) => ({
            definitionVersionId: query.definitionVersionId,
            metricKey: 'portal.rating_count',
            state: 'updating',
            exactValue: 0,
            sampleCount: 0,
            minimumSample: 0,
            sourceCompleteThrough: null,
            reason: 'source_reconciling',
          }),
          getApprovedGoalVersion: async (versionId) => findMetricVersionById(versionId),
        },
        id: randomUUID,
        now: () => clock.now,
      })
      const definition = {
        propertyId: targetPropertyId,
        metric: 'portal_rating_count',
        subjects: [{ kind: 'property', propertyId: targetPropertyId }],
      } as const
      const created = await service.create(
        { ...definition, name: 'February ratings', targetValue: 25 },
        actor,
      )
      expect(created.program.status).toBe('scheduled')
      clock.now = editedAt
      const revised = await service.revise(
        { ...definition, programId: created.program.id, targetValue: 40 },
        actor,
      )
      expect(revised.version).toMatchObject({
        version: 2,
        effectiveFrom: february.start,
        changeReason: 'revised',
      })

      clock.now = new Date('2026-02-01T00:10:00.000Z')
      await expect(service.maintain()).resolves.toMatchObject({
        inspected: 1,
        activated: 1,
        scheduledResults: 1,
        failed: 0,
      })
      const activated = await service.get(
        { propertyId: targetPropertyId, programId: created.program.id },
        actor,
      )
      expect(activated).toMatchObject({
        program: { status: 'active', currentVersion: 2 },
        version: { id: revised.version.id, targetValue: 40 },
        results: [{ programVersionId: revised.version.id, periodStart: february.start }],
      })
      expect(windowsOf(activated).versions).toEqual([
        [1, february.start, february.start],
        [2, february.start, null],
      ])

      // March has begun and the hourly job has not opened it yet: the next
      // revision opens it under the version in force and starts in April.
      clock.now = new Date('2026-03-01T00:10:00.000Z')
      const next = await service.revise(
        { ...definition, programId: created.program.id, targetValue: 55 },
        actor,
      )
      expect(next.version).toMatchObject({ version: 3, effectiveFrom: march.end })
      const settled = await service.get(
        { propertyId: targetPropertyId, programId: created.program.id },
        actor,
      )
      expect(
        settled.results.map((monthly) => [monthly.programVersionId, monthly.periodStart]),
      ).toEqual([
        [revised.version.id, february.start],
        [revised.version.id, march.start],
      ])
      expect(windowsOf(settled).versions).toEqual([
        [1, february.start, february.start],
        [2, february.start, march.end],
        [3, march.end, null],
      ])
    })
  })

  describe('a Program changed in place', () => {
    const at = new Date('2026-01-15T12:00:00.000Z')
    const februaryStart = new Date('2026-02-01T00:00:00.000Z')

    async function scheduledGoal(label: string) {
      const repository = createGoalProgramRepository(getDb())
      const targetPropertyId = await createPropertyFixture(label)
      const bundle = programBundle({
        propertyId: targetPropertyId,
        status: 'scheduled',
        effectiveFrom: februaryStart,
        at,
      })
      await repository.create({ bundle, auditAction: 'goal.program.created' })
      return { repository, targetPropertyId, bundle }
    }

    const auditDetails = async (programId: string, action: string) => {
      const { rows } = await lease.pool.query<{ details: Record<string, unknown> }>(
        `SELECT details FROM audit_logs
          WHERE organization_id = $1 AND resource_id = $2 AND action = $3`,
        [organizationId, programId, action],
      )
      return rows.map(({ details }) => details)
    }

    it('a status change without a note stores no status reason', async () => {
      const { repository, targetPropertyId, bundle } = await scheduledGoal(
        'Unexplained Goal Property',
      )

      await expect(
        repository.changeStatus({
          organizationId,
          propertyId: targetPropertyId,
          programId: bundle.program.id,
          expectedStatus: 'scheduled',
          status: 'ended',
          reason: null,
          actorId: 'manager-1',
          at,
        }),
      ).resolves.toMatchObject({ status: 'ended', statusReason: null })
      await expect(
        auditDetails(bundle.program.id, 'goal.program.status_changed'),
      ).resolves.toEqual([
        { propertyId: targetPropertyId, previousStatus: 'scheduled', status: 'ended' },
      ])
    })

    // Ending needs exactly one open version to close. Without one the version
    // history changed under the command: a conflict to report, not a failure.
    it('reports an ending that finds no open version as a conflict and writes nothing', async () => {
      const { repository, targetPropertyId, bundle } = await scheduledGoal(
        'Conflicting End Property',
      )
      await lease.pool.query(
        `UPDATE goal_program_versions SET effective_to = effective_from WHERE id = $1`,
        [bundle.version.id],
      )

      await expect(
        repository.changeStatus({
          organizationId,
          propertyId: targetPropertyId,
          programId: bundle.program.id,
          expectedStatus: 'scheduled',
          status: 'ended',
          reason: 'Ended by manager',
          actorId: 'manager-1',
          at,
        }),
      ).resolves.toBeNull()
      await expect(
        repository.get(organizationId, targetPropertyId, bundle.program.id),
      ).resolves.toMatchObject({
        program: { status: 'scheduled', statusReason: 'awaiting_first_full_month' },
      })
      await expect(
        auditDetails(bundle.program.id, 'goal.program.status_changed'),
      ).resolves.toEqual([])
    })
  })
})
