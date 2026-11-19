// Maintenance reads current state independently of retained months. The ledger
// stays pageable even beyond PostgreSQL's parameter limit. Fixtures live in a
// held transaction because monthly results are immutable and cannot be deleted.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { METRIC_DEFINITION_IDS, METRIC_VERSION_IDS } from '../../readings/contracts'
import type {
  GoalDueResultCursor,
  GoalProgramBundle,
} from '../../application/ports/goal-program.repository'
import { createGoalProgramRepository } from './goal-program.repository'

/** One more month than a single statement can bind an id for. */
const RESULT_COUNT = 65_536
const FIRST_MONTH = '2026-01-01T00:00:00.000Z'

describe.sequential('Goal Program listing for maintenance (integration)', () => {
  let held: HeldTransaction | undefined
  let client: HeldTransaction['client']
  let db: Database

  async function activeGoalWithMonths(
    count: number,
    organizationId = `goal-listing-${randomUUID()}`,
  ): Promise<GoalProgramBundle> {
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

    const listed = (
      await createGoalProgramRepository(db).listOperational({
        organizationId: goal.program.organizationId,
        propertyId: goal.program.propertyId,
        id: '00000000-0000-0000-0000-000000000000',
      })
    ).find((bundle) => bundle.program.id === goal.program.id)

    expect(listed?.results).toHaveLength(1)
    const repository = createGoalProgramRepository(db)
    let retained = 0
    const retainedIds = new Set<string>()
    let after: { periodStart: Date; id: string } | undefined
    do {
      const page = await repository.listHistory(
        goal.program.organizationId,
        goal.program.propertyId,
        goal.program.id,
        { after },
      )
      expect(page.results.length).toBeLessThanOrEqual(100)
      retained += page.results.length
      for (const result of page.results) retainedIds.add(result.id)
      after = page.next ?? undefined
    } while (after)
    expect(retained).toBe(RESULT_COUNT)
    expect(retainedIds.size).toBe(RESULT_COUNT)
  }, 120_000)

  it('reads current figures independently of the ledger and pages every retained month', async () => {
    const goal = await activeGoalWithMonths(7)
    const repository = createGoalProgramRepository(db)
    const summary = await repository.getSummary(
      goal.program.organizationId,
      goal.program.propertyId,
      goal.program.id,
    )
    expect(summary?.results).toHaveLength(2)
    const pages = []
    let after: { periodStart: Date; id: string } | undefined
    do {
      const page = await repository.listHistory(
        goal.program.organizationId,
        goal.program.propertyId,
        goal.program.id,
        { limit: 3, after },
      )
      expect(page.results.length).toBeLessThanOrEqual(3)
      pages.push(...page.results)
      after = page.next ?? undefined
    } while (after)
    expect(pages).toHaveLength(7)
    expect(new Set(pages.map((row) => row.id)).size).toBe(7)
    expect(pages.map((row) => row.periodStart.toISOString())).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ])
    expect(
      await repository.getSummary(
        'another-tenant',
        goal.program.propertyId,
        goal.program.id,
      ),
    ).toBeNull()
    expect(
      (
        await repository.listHistory(
          'another-tenant',
          goal.program.propertyId,
          goal.program.id,
          { limit: 3 },
        )
      ).results,
    ).toEqual([])
  })

  it('bounds Program and due-result pages and crosses cursor ties without losing history', async () => {
    const prefix = `goal-paging-${randomUUID()}`
    const goals: GoalProgramBundle[] = []
    for (let index = 0; index < 101; index++) {
      goals.push(
        await activeGoalWithMonths(1, `${prefix}-${String(index).padStart(3, '0')}`),
      )
    }
    const repository = createGoalProgramRepository(db)
    const first = await repository.listOperational({
      organizationId: prefix,
      propertyId: '00000000-0000-0000-0000-000000000000',
      id: '00000000-0000-0000-0000-000000000000',
    })
    expect(first.map(({ program }) => program.id)).toEqual(
      goals.slice(0, 100).map(({ program }) => program.id),
    )
    expect(first.every(({ results }) => results.length === 1)).toBe(true)
    const last = first[99]!.program
    const second = await repository.listOperational({
      organizationId: last.organizationId,
      propertyId: last.propertyId,
      id: last.id,
    })
    expect(second[0]!.program.id).toBe(goals[100]!.program.id)

    const expected = new Set(goals.map(({ program }) => program.id))
    const seen: string[] = []
    const visited = new Set<string>()
    let after: GoalDueResultCursor | undefined
    while (true) {
      const page = await repository.listDueResults(
        new Date('2026-02-01T00:00:00Z'),
        after,
      )
      expect(page.length).toBeLessThanOrEqual(100)
      for (const result of page) {
        expect(visited.has(result.id)).toBe(false)
        visited.add(result.id)
      }
      seen.push(
        ...page
          .filter((result) => expected.has(result.programId))
          .map((result) => result.programId),
      )
      if (page.length < 100) break
      const tail = page[99]!
      after = { periodEnd: tail.periodEnd, id: tail.id }
    }
    expect(seen).toHaveLength(101)
    expect(new Set(seen)).toEqual(expected)
  }, 120_000)
})
