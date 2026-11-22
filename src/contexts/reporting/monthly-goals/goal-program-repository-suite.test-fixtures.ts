// Harness of the Goal Program repository suites against committed rows.
//
// Properties get unique labels, so suites share one database without a
// transaction: nothing here is rolled back, and nothing reads another
// suite's rows.
import { afterAll, beforeAll } from 'vitest'
import { newTestId, testDatabaseUrl, testDb } from '#/shared/testing/ambient-test-runtime'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { GoalProgramBundle } from '../application/ports/goal-program.repository'
import type { GoalSubject } from '../domain/goal-program'
import { goalBundle } from './goal-program-bundle.test-fixtures'
import { createGoalProgramRepository } from './goal-program-repository.server'

export type SeededBundleInput = Readonly<{
  status: 'scheduled' | 'active'
  effectiveFrom: Date
  at: Date
  withOpenResult?: Readonly<{ end: Date }>
  timezone?: string
}>

type EndInput = Readonly<{
  expectedStatus: 'scheduled' | 'active' | 'paused'
  status: 'paused' | 'ended'
  reason: string | null
  at: Date
  actorId?: string
}>

export function useGoalProgramRepositorySuite(slug: string) {
  let lease: TestLease
  const organizationId = `${slug}-${newTestId()}`
  const propertyId = newTestId()

  beforeAll(async () => {
    lease = await acquireTestLease(testDatabaseUrl())
    await lease.pool.query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Goal Repository Property', $3, 'UTC')`,
      [propertyId, organizationId, `goal-repository-${newTestId()}`],
    )
  })

  afterAll(async () => {
    await lease?.release()
  })

  const repository = () => createGoalProgramRepository(testDb())

  async function createProperty(label: string): Promise<string> {
    const id = newTestId()
    await lease.pool.query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, $3, $4, 'UTC')`,
      [id, organizationId, label, `goal-${newTestId()}`],
    )
    return id
  }

  function bundle(
    input: SeededBundleInput & Readonly<{ propertyId: string }>,
  ): GoalProgramBundle {
    return goalBundle({
      organizationId,
      programId: newTestId(),
      propertyId: input.propertyId,
      status: input.status,
      effectiveFrom: input.effectiveFrom,
      at: input.at,
      timezone: input.timezone,
      openMonths: input.withOpenResult
        ? [{ start: input.effectiveFrom, end: input.withOpenResult.end }]
        : [],
    })
  }

  /** A new Property with a goal on it, written through the repository. */
  async function seed(label: string, input: SeededBundleInput) {
    const targetPropertyId = await createProperty(label)
    const created = bundle({ ...input, propertyId: targetPropertyId })
    const repo = repository()
    await repo.create({ bundle: created, auditAction: 'goal.program.created' })
    return { repository: repo, targetPropertyId, bundle: created }
  }

  const endGoal = (goal: GoalProgramBundle, input: EndInput) =>
    repository().changeStatus({
      organizationId,
      propertyId: goal.program.propertyId,
      programId: goal.program.id,
      expectedStatus: input.expectedStatus,
      status: input.status,
      reason: input.reason,
      actorId: input.actorId ?? 'manager-1',
      at: input.at,
    })

  const history = (goal: GoalProgramBundle) =>
    repository().getHistory(organizationId, goal.program.propertyId, goal.program.id)

  const conflictsFor = (
    forPropertyId: string,
    effectiveFrom: Date,
    subjects: readonly GoalSubject[] = [{ kind: 'property', propertyId: forPropertyId }],
    excludeProgramId?: string,
  ) =>
    repository().findAssignmentConflicts({
      organizationId,
      propertyId: forPropertyId,
      ...(excludeProgramId ? { excludeProgramId } : {}),
      metric: 'portal_rating_count',
      effectiveFrom,
      subjects,
    })

  return {
    organizationId,
    propertyId,
    get pool() {
      return lease.pool
    },
    repository,
    createProperty,
    bundle,
    seed,
    endGoal,
    history,
    conflictsFor,
  }
}
