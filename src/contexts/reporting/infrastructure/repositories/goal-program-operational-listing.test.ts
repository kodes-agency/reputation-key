// The hourly job's listing of scheduled and active goals, against PostgreSQL.
//
// It loads every program's versions, assignments, results and the revisions of
// those results by id. PostgreSQL takes at most 65,535 bound values in one
// statement, and node-postgres writes the count as a 16-bit integer, so a
// listing whose results outnumber that fails: nothing activates, no month
// opens, no result reconciles or closes, for any tenant, until the volume
// shrinks, and it never does (closed months are kept).
//
// Nothing is committed: monthly results cannot be deleted, so the fixture and
// every statement run in one held transaction that is rolled back.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { METRIC_DEFINITION_IDS, METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type { GoalProgramBundle } from '../../application/ports/goal-program.repository'
import { createGoalProgramRepository } from './goal-program.repository'

/** One more month than a single statement can bind an id for. */
const RESULT_COUNT = 65_536
const FIRST_MONTH = '2026-01-01T00:00:00.000Z'

describe.sequential('Goal Program listing for maintenance (integration)', () => {
  let held: HeldTransaction | undefined
  let client: HeldTransaction['client']
  let db: Database

  async function activeGoalWithMonths(count: number): Promise<GoalProgramBundle> {
    const organizationId = `goal-listing-${randomUUID()}`
    const propertyId = randomUUID()
    const programId = randomUUID()
    const createdAt = new Date(FIRST_MONTH)
    await client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Goal Listing Property', $3, 'UTC')`,
      [propertyId, organizationId, `goal-listing-${randomUUID()}`],
    )
    const version = {
      id: randomUUID(),
      programId,
      organizationId,
      propertyId,
      version: 1,
      metricDefinitionId: METRIC_DEFINITION_IDS.portalRatingCount,
      metricDefinitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metric: 'portal_rating_count' as const,
      metricMinimumSample: 0,
      targetValue: 10,
      propertyTimezone: 'UTC',
      effectiveFrom: createdAt,
      effectiveTo: null,
      changeReason: 'created',
      createdBy: 'manager-1',
      createdAt,
    }
    const assignmentId = randomUUID()
    const bundle: GoalProgramBundle = {
      program: {
        id: programId,
        organizationId,
        propertyId,
        name: 'Ratings for centuries',
        description: null,
        status: 'active',
        statusReason: null,
        currentVersion: 1,
        createdBy: 'manager-1',
        createdAt,
        updatedAt: createdAt,
      },
      version,
      versions: [version],
      assignments: [
        {
          id: assignmentId,
          programId,
          programVersionId: version.id,
          organizationId,
          propertyId,
          metric: 'portal_rating_count',
          subject: { kind: 'property', propertyId },
          effectiveFrom: createdAt,
          effectiveTo: null,
          createdBy: 'manager-1',
          createdAt,
        },
      ],
      results: [],
    }
    await createGoalProgramRepository(db).create({
      bundle,
      auditAction: 'goal.program.created',
    })
    // Calendar months in UTC, whatever zone the session is in.
    await client.query(
      `INSERT INTO goal_monthly_results (
         id, assignment_id, program_id, program_version_id, organization_id,
         property_id, period_start, period_end, property_timezone, status,
         evaluation_state, sample_count, created_at, updated_at
       )
       SELECT gen_random_uuid(), $1, $2, $3, $4, $5,
              month AT TIME ZONE 'UTC',
              (month + interval '1 month') AT TIME ZONE 'UTC',
              'UTC', 'open', 'updating', 0, $6, $6
       FROM generate_series(
         timestamp '2026-01-01 00:00:00',
         timestamp '2026-01-01 00:00:00' + make_interval(months => $7::int - 1),
         interval '1 month'
       ) AS month`,
      [assignmentId, programId, version.id, organizationId, propertyId, createdAt, count],
    )
    return bundle
  }

  beforeAll(async () => {
    held = await holdTransaction()
    client = held.client
    db = held.db
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  it('lists a goal that holds more results than one statement can bind an id for', async () => {
    const goal = await activeGoalWithMonths(RESULT_COUNT)

    const listed = (await createGoalProgramRepository(db).listOperational()).find(
      (bundle) => bundle.program.id === goal.program.id,
    )

    expect(listed?.results).toHaveLength(RESULT_COUNT)
  }, 120_000)
})
