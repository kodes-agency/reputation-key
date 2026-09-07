import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import {
  METRIC_DEFINITION_IDS,
  METRIC_VERSION_IDS,
} from '#/contexts/metric/application/public-api'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../../application/ports/goal-program.repository'
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
  ): GoalMonthlyResult => ({
    id: randomUUID(),
    assignmentId: subjectAssignment.id,
    programId: subjectAssignment.programId,
    programVersionId: subjectAssignment.programVersionId,
    organizationId,
    propertyId: subjectAssignment.propertyId,
    periodStart: start,
    periodEnd: end,
    propertyTimezone: 'UTC',
    status: 'open',
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
    }>,
  ): GoalProgramBundle {
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
      propertyTimezone: 'UTC',
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
      outboxEventId: randomUUID(),
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
        outboxEventId: randomUUID(),
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
        actorId: 'manager-1',
        at: nextAt,
        outboxEventId: randomUUID(),
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
        outboxEventId: randomUUID(),
      }),
    ).resolves.toBe(1)
    await expect(
      repository.appendResults({
        program: revised.program,
        version: revised.version,
        results: [marchResult],
        at: nextAt,
        outboxEventId: randomUUID(),
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
    ).resolves.toEqual([{ kind: 'property', propertyId }])
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
        actorId: 'manager-1',
        at: nextAt,
        outboxEventId: randomUUID(),
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
      outboxEventId: randomUUID(),
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
        outboxEventId: randomUUID(),
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
        outboxEventId: randomUUID(),
      }),
    ).resolves.toBeUndefined()
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
      outboxEventId: randomUUID(),
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
        outboxEventId: randomUUID(),
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
        outboxEventId: randomUUID(),
      }),
    ).resolves.toBeUndefined()
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
      outboxEventId: randomUUID(),
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
})
