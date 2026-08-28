import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { METRIC_VERSION_IDS } from '#/contexts/metric/application/public-api'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
} from '../../application/ports/goal-program.repository'
import { createGoalProgramRepository } from './goal-program.repository'

describe.sequential('Goal Program result CAS and outbox (integration)', () => {
  let lease: TestLease
  let organizationId: string
  let propertyId: string
  let metricDefinitionId: string

  beforeAll(async () => {
    registerAllEventSchemas()
    lease = await acquireTestLease(getEnv().DATABASE_URL, 8)
    organizationId = `goal-result-atomicity-${randomUUID()}`
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
       VALUES ($1, $2, 'Goal Result Atomicity Property', $3, 'UTC')`,
      [propertyId, organizationId, `goal-result-atomicity-${randomUUID()}`],
    )
  })

  afterAll(async () => {
    await lease?.release()
  })

  async function seedReconcilingResult(): Promise<GoalMonthlyResult> {
    const createdAt = new Date('2026-07-01T00:00:00.000Z')
    const periodEnd = new Date('2026-08-01T00:00:00.000Z')
    const programId = randomUUID()
    const programVersionId = randomUUID()
    const assignmentId = randomUUID()
    const portalId = randomUUID()
    await lease.pool.query(
      `INSERT INTO portals
         (id, organization_id, property_id, entity_type, entity_id, name, slug)
       VALUES ($1, $2, $3, 'property', $5, 'Atomic result QR', $4)`,
      [portalId, organizationId, propertyId, `atomic-result-${randomUUID()}`, propertyId],
    )
    const result: GoalMonthlyResult = {
      id: randomUUID(),
      assignmentId,
      programId,
      programVersionId,
      organizationId,
      propertyId,
      periodStart: createdAt,
      periodEnd,
      propertyTimezone: 'UTC',
      status: 'reconciling',
      evaluation: {
        state: 'eligible',
        value: 12,
        sampleCount: 12,
        achieved: true,
        reason: null,
      },
      sourceCompleteThrough: periodEnd,
      evaluationWatermark: periodEnd,
      closedAt: null,
      createdAt,
      updatedAt: periodEnd,
    }
    const bundle: GoalProgramBundle = {
      program: {
        id: programId,
        organizationId,
        propertyId,
        name: `Monthly ratings ${randomUUID()}`,
        description: null,
        status: 'active',
        statusReason: null,
        currentVersion: 1,
        createdBy: 'manager-1',
        createdAt,
        updatedAt: createdAt,
      },
      version: {
        id: programVersionId,
        programId,
        organizationId,
        propertyId,
        version: 1,
        metricDefinitionId,
        metricDefinitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
        metric: 'portal_rating_count',
        metricMinimumSample: 0,
        targetValue: 10,
        propertyTimezone: 'UTC',
        effectiveFrom: createdAt,
        effectiveTo: null,
        changeReason: 'created',
        createdBy: 'manager-1',
        createdAt,
      },
      versions: [],
      assignments: [
        {
          id: assignmentId,
          programId,
          programVersionId,
          organizationId,
          propertyId,
          metric: 'portal_rating_count',
          subject: { kind: 'portal', portalId },
          effectiveFrom: createdAt,
          effectiveTo: null,
          createdBy: 'manager-1',
          createdAt,
        },
      ],
      results: [result],
    }
    await createGoalProgramRepository(getDb()).create({
      bundle,
      auditAction: 'goal.program.created',
      outboxEventId: randomUUID(),
    })
    return result
  }

  it('allows one concurrent close, records one authoritative fact, and ignores replay', async () => {
    const repository = createGoalProgramRepository(getDb())
    const current = await seedReconcilingResult()
    const closedAt = new Date('2026-08-02T12:00:00.000Z')
    // Deliberately stale caller-owned aggregate fields prove the event is built
    // from the authoritative row returned by PostgreSQL, not this object.
    const closeCandidate: GoalMonthlyResult = {
      ...current,
      programId: randomUUID(),
      programVersionId: randomUUID(),
      assignmentId: randomUUID(),
      status: 'closed',
      closedAt,
      evaluationWatermark: closedAt,
      updatedAt: closedAt,
    }
    const attempts = await Promise.all(
      [0, 1].map(() =>
        repository.updateResult({
          result: closeCandidate,
          expectedStatus: 'reconciling',
        }),
      ),
    )

    expect(attempts.filter((result) => result !== null)).toHaveLength(1)
    expect(attempts.filter((result) => result === null)).toHaveLength(1)
    expect(attempts.find((result) => result !== null)).toMatchObject({
      id: current.id,
      assignmentId: current.assignmentId,
      programId: current.programId,
      programVersionId: current.programVersionId,
      status: 'closed',
    })

    await expect(
      repository.updateResult({
        result: closeCandidate,
        expectedStatus: 'reconciling',
      }),
    ).resolves.toBeNull()

    const facts = await lease.pool.query<{
      id: string
      source_aggregate_id: string
      organization_id: string
      property_id: string
      payload: Record<string, unknown>
    }>(
      `SELECT id, source_aggregate_id, organization_id, property_id, payload
       FROM outbox_events
       WHERE event_type = 'goal.monthly_result.closed'
         AND payload->>'monthlyResultId' = $1`,
      [current.id],
    )
    expect(facts.rows).toHaveLength(1)
    expect(facts.rows[0]?.id).toEqual(expect.any(String))
    expect(facts.rows[0]).toMatchObject({
      source_aggregate_id: current.id,
      organization_id: organizationId,
      property_id: propertyId,
      payload: {
        organizationId,
        propertyId,
        programId: current.programId,
        programVersionId: current.programVersionId,
        assignmentId: current.assignmentId,
        monthlyResultId: current.id,
        status: 'closed',
        evaluationState: 'eligible',
        achieved: true,
        occurredAt: closedAt.toISOString(),
      },
    })
  })

  it('projects the latest append-only correction without rewriting the closed result', async () => {
    const repository = createGoalProgramRepository(getDb())
    const current = await seedReconcilingResult()
    const closedAt = new Date('2026-08-02T12:00:00.000Z')
    await expect(
      repository.updateResult({
        result: {
          ...current,
          status: 'closed',
          closedAt,
          evaluationWatermark: closedAt,
          updatedAt: closedAt,
        },
        expectedStatus: 'reconciling',
      }),
    ).resolves.toMatchObject({ status: 'closed', evaluation: { value: 12 } })

    const closedHead = await repository.getClosedResult(
      organizationId,
      propertyId,
      current.id,
    )
    if (!closedHead) throw new Error('closed result head is missing')
    const firstRevisionId = randomUUID()
    const firstAt = new Date('2026-08-03T12:00:00.000Z')
    await expect(
      repository.appendResultRevision({
        head: closedHead,
        revisionId: firstRevisionId,
        evaluation: {
          state: 'eligible',
          value: 8,
          sampleCount: 8,
          achieved: false,
          reason: null,
        },
        sourceCompleteThrough: current.periodEnd,
        evaluationWatermark: firstAt,
        changeReason: 'late withdrawal',
        createdBy: 'system',
        at: firstAt,
      }),
    ).resolves.toMatchObject({
      status: 'revised',
      revision: { id: firstRevisionId, revision: 1 },
      outcomeChanged: true,
      availabilityChanged: false,
    })

    const latestAt = new Date('2026-08-04T12:00:00.000Z')
    const latestRevisionId = randomUUID()
    const latestInput = {
      head: closedHead,
      revisionId: latestRevisionId,
      evaluation: {
        state: 'eligible' as const,
        value: 14,
        sampleCount: 14,
        achieved: true,
        reason: null,
      },
      sourceCompleteThrough: current.periodEnd,
      evaluationWatermark: latestAt,
      changeReason: 'verified replay correction',
      createdBy: 'system',
      at: latestAt,
    }
    await expect(repository.appendResultRevision(latestInput)).resolves.toEqual({
      status: 'conflict',
    })
    const currentHead = await repository.getClosedResult(
      organizationId,
      propertyId,
      current.id,
    )
    if (!currentHead) throw new Error('current corrected result head is missing')
    await expect(
      repository.appendResultRevision({ ...latestInput, head: currentHead }),
    ).resolves.toMatchObject({
      status: 'revised',
      revision: {
        id: latestRevisionId,
        revision: 2,
        supersedesRevisionId: firstRevisionId,
      },
      outcomeChanged: true,
      availabilityChanged: false,
    })

    const projected = await repository.get(organizationId, propertyId, current.programId)
    expect(projected?.results).toEqual([
      expect.objectContaining({
        id: current.id,
        status: 'closed',
        evaluation: {
          state: 'eligible',
          value: 14,
          sampleCount: 14,
          achieved: true,
          reason: null,
        },
        sourceCompleteThrough: current.periodEnd,
        evaluationWatermark: latestAt,
        updatedAt: latestAt,
      }),
    ])
    const base = await lease.pool.query<{ value: number }>(
      `SELECT value::float8 AS value FROM goal_monthly_results WHERE id = $1`,
      [current.id],
    )
    expect(base.rows[0]?.value).toBe(12)
    const revisions = await lease.pool.query<{
      revision: number
      supersedes_revision_id: string | null
    }>(
      `SELECT revision, supersedes_revision_id
       FROM goal_result_revisions
       WHERE organization_id = $1 AND property_id = $2 AND monthly_result_id = $3
       ORDER BY revision`,
      [organizationId, propertyId, current.id],
    )
    expect(revisions.rows).toEqual([
      { revision: 1, supersedes_revision_id: null },
      { revision: 2, supersedes_revision_id: firstRevisionId },
    ])
    const facts = await lease.pool.query<{
      payload: Record<string, unknown>
    }>(
      `SELECT payload
       FROM outbox_events
       WHERE event_type = 'goal.monthly_result.revised'
         AND payload->>'monthlyResultId' = $1
       ORDER BY payload->>'revision'`,
      [current.id],
    )
    expect(facts.rows.map(({ payload }) => payload)).toEqual([
      expect.objectContaining({
        revisionId: firstRevisionId,
        revision: 1,
        supersedesRevisionId: null,
        outcomeChanged: true,
      }),
      expect.objectContaining({
        revisionId: latestRevisionId,
        revision: 2,
        supersedesRevisionId: firstRevisionId,
        outcomeChanged: true,
      }),
    ])
  })

  it('rolls back the result transition when its outbox insert cannot commit', async () => {
    const repository = createGoalProgramRepository(getDb())
    const current = await seedReconcilingResult()
    const failureConstraint = 'goal_monthly_result_closed_test_failure'
    await lease.pool.query(
      `ALTER TABLE outbox_events
       ADD CONSTRAINT ${failureConstraint}
       CHECK (event_type <> 'goal.monthly_result.closed') NOT VALID`,
    )
    const closedAt = new Date('2026-08-02T13:00:00.000Z')

    try {
      await expect(
        repository.updateResult({
          result: {
            ...current,
            status: 'closed',
            closedAt,
            evaluationWatermark: closedAt,
            updatedAt: closedAt,
          },
          expectedStatus: 'reconciling',
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } })
    } finally {
      await lease.pool.query(
        `ALTER TABLE outbox_events DROP CONSTRAINT ${failureConstraint}`,
      )
    }

    const persisted = await lease.pool.query<{ status: string; closed_at: Date | null }>(
      `SELECT status, closed_at
       FROM goal_monthly_results
       WHERE organization_id = $1 AND property_id = $2 AND id = $3`,
      [organizationId, propertyId, current.id],
    )
    expect(persisted.rows[0]).toEqual({ status: 'reconciling', closed_at: null })
    const facts = await lease.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM outbox_events
       WHERE event_type = 'goal.monthly_result.closed'
         AND payload->>'monthlyResultId' = $1`,
      [current.id],
    )
    expect(facts.rows[0]?.count).toBe(0)
  })
})
