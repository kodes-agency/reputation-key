import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  createGoalsForSubjects,
  type GoalBulkCreateDependencies,
  type GoalBulkCreateInput,
} from '../../application/use-cases/goal-bulk-create'
import type { GoalActor } from '../../application/use-cases/goal-programs'
import type { GoalSubject } from '../../domain/goal-program'
import { findMetricVersionById } from '../../domain/metric-registry'
import { createGoalProgramRepository } from './goal-program.repository'

const MID_MARCH = new Date('2026-03-15T12:00:00.000Z')
const UTC_MARCH = {
  start: new Date('2026-03-01T00:00:00.000Z'),
  end: new Date('2026-04-01T00:00:00.000Z'),
}

/**
 * One goal per row against PostgreSQL: the unit suite proves the save's rules
 * on fakes, and this proves what only the database can. Each row is a write of
 * its own, so a row the database refuses leaves the rows around it saved; and
 * a later save finds the goals of an earlier one through the real conflict
 * read, for Portal Group subjects, which carry their own foreign key and their
 * own arm of the no-overlap constraint.
 *
 * Monthly results cannot be deleted, so nothing is committed: the fixture and
 * every save run inside one held transaction that is rolled back. Each goal's
 * transaction is a savepoint inside it.
 */
describe.sequential('Goals for several subjects (integration)', () => {
  let held: HeldTransaction | undefined
  let deps: GoalBulkCreateDependencies
  let logged: ReturnType<typeof vi.fn>
  const organizationId = `goal-bulk-${randomUUID()}`
  const propertyId = randomUUID()
  const actor: GoalActor = { organizationId, userId: 'manager-1', role: 'AccountAdmin' }
  const group = (): GoalSubject => ({ kind: 'portal_group', portalGroupId: randomUUID() })
  const north = group()
  const south = group()
  const east = group()
  /** Named a moment ago and gone from the database by the time its goal is written. */
  const removed = group()
  const names = new Map<GoalSubject, string>([
    [north, 'North wing'],
    [south, 'South wing'],
    [east, 'East wing'],
    [removed, 'Removed wing'],
  ])

  beforeAll(async () => {
    held = await holdTransaction()
    const { client, db } = held
    await client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Goal bulk Property', $3, 'UTC')`,
      [propertyId, organizationId, `goal-bulk-${randomUUID()}`],
    )
    for (const subject of [north, south, east]) {
      if (subject.kind !== 'portal_group') continue
      await client.query(
        `INSERT INTO portal_groups (id, organization_id, property_id, name)
         VALUES ($1, $2, $3, $4)`,
        [subject.portalGroupId, organizationId, propertyId, names.get(subject)],
      )
    }
    logged = vi.fn()
    deps = {
      repository: createGoalProgramRepository(db),
      policy: { authorize: async () => undefined },
      subjects: {
        getTimezone: async () => 'UTC',
        subjectBelongsToProperty: async () => true,
        listCurrentPortalIds: async () => [],
      },
      subjectNames: {
        getSubjectName: async (_organizationId, _propertyId, subject) =>
          [...names].find(
            ([named]) =>
              named.kind === 'portal_group' &&
              subject.kind === 'portal_group' &&
              named.portalGroupId === subject.portalGroupId,
          )?.[1] ?? null,
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
      logger: { ...createMockLogger(), error: logged },
      id: randomUUID,
      now: () => MID_MARCH,
    }
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  const save = (
    items: GoalBulkCreateInput['items'],
    patch: Partial<GoalBulkCreateInput> = {},
  ): GoalBulkCreateInput => ({
    propertyId,
    metric: 'portal_rating_count',
    startMonth: '2026-03',
    items,
    ...patch,
  })

  const savedGoals = async () =>
    (await deps.repository.list(organizationId, propertyId))
      .map((bundle) => ({
        name: bundle.program.name,
        status: bundle.program.status,
        metric: bundle.version.metric,
        target: bundle.version.targetValue,
        subjects: bundle.assignments.map((assignment) => assignment.subject),
        months: bundle.results.map((result) => [result.periodStart, result.periodEnd]),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))

  it('saves each row on its own: a row the database refuses does not undo the others', async () => {
    const result = await createGoalsForSubjects(
      deps,
      save([
        { subject: north, targetValue: 40 },
        { subject: removed, targetValue: 10 },
        { subject: south, targetValue: 15 },
      ]),
      actor,
    )

    expect(result.outcomes).toEqual([
      { subject: north, code: 'created', programId: expect.any(String) },
      { subject: removed, code: 'failed' },
      { subject: south, code: 'created', programId: expect.any(String) },
    ])
    // The refusal is the group's foreign key, met after the goal's Program and
    // version were written: the whole goal is rolled back, not half of it.
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        error: expect.objectContaining({
          cause: expect.objectContaining({
            code: '23503',
            constraint: 'goal_subject_assignments_portal_group_fk',
          }),
        }),
      }),
      expect.any(String),
    )
    expect(await savedGoals()).toEqual([
      {
        name: 'North wing · Private ratings',
        status: 'active',
        metric: 'portal_rating_count',
        target: 40,
        subjects: [north],
        months: [[UTC_MARCH.start, UTC_MARCH.end]],
      },
      {
        name: 'South wing · Private ratings',
        status: 'active',
        metric: 'portal_rating_count',
        target: 15,
        subjects: [south],
        months: [[UTC_MARCH.start, UTC_MARCH.end]],
      },
    ])
  })

  it('a later save finds the goals of an earlier one and saves only the free rows', async () => {
    const result = await createGoalsForSubjects(
      deps,
      save([
        { subject: north, targetValue: 99 },
        { subject: east, targetValue: 20 },
        { subject: south, targetValue: 99 },
      ]),
      actor,
    )

    expect(result.outcomes).toEqual([
      { subject: north, code: 'subject_has_goal' },
      { subject: east, code: 'created', programId: expect.any(String) },
      { subject: south, code: 'subject_has_goal' },
    ])
    expect((await savedGoals()).map((goal) => [goal.name, goal.target])).toEqual([
      ['East wing · Private ratings', 20],
      ['North wing · Private ratings', 40],
      ['South wing · Private ratings', 15],
    ])
  })

  it('a goal for another measure is free for a subject that has one, and waits for next month when set for it', async () => {
    const result = await createGoalsForSubjects(
      deps,
      save([{ subject: north, targetValue: 300 }], {
        metric: 'qualified_scans',
        startMonth: '2026-04',
      }),
      actor,
    )

    expect(result.outcomes).toEqual([
      { subject: north, code: 'created', programId: expect.any(String) },
    ])
    expect(
      (await savedGoals()).find((goal) => goal.metric === 'qualified_scans'),
    ).toEqual({
      name: 'North wing · Qualified scans',
      status: 'scheduled',
      metric: 'qualified_scans',
      target: 300,
      subjects: [north],
      months: [],
    })
  })
})
