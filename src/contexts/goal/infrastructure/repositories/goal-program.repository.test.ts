import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { METRIC_VERSION_IDS } from '#/contexts/metric/application/public-api'
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
    const metric = await lease.pool.query<{ definition_id: string }>(
      `SELECT definition_id FROM metric_definition_versions WHERE id = $1`,
      [METRIC_VERSION_IDS.portalRatingCountGoal],
    )
    metricDefinitionId = metric.rows[0]?.definition_id ?? ''
    if (!metricDefinitionId) throw new Error('seeded Goal metric version is missing')
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
  ): GoalSubjectAssignment => ({
    id: randomUUID(),
    programId,
    programVersionId,
    organizationId,
    propertyId,
    metric: 'portal_rating_count',
    subject: { kind: 'property', propertyId },
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
    propertyId,
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
    await repository.revise({
      expectedVersion: firstVersion,
      version: nextVersion,
      assignments: [nextAssignment],
      actorId: 'manager-1',
      at: nextAt,
      outboxEventId: randomUUID(),
    })

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
  })
})
