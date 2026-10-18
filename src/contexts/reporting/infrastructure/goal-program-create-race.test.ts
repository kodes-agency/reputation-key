// Two creates for one subject and metric that insert at the same moment both
// wait on each other inside the no-overlap check, and PostgreSQL ends one of
// them as a deadlock victim (40P01), not as a conflict (23P01). The repository
// runs that transaction once more: by then the other create has its row, so the
// second attempt meets the conflict and the caller is told `subject_has_goal`,
// never an unmapped failure. The real race is in
// monthly-portal-goal.integration.test.ts.
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import type { GoalProgramBundle } from '../application/ports/goal-program.repository'
import { createGoalProgramRepository } from './repositories/goal-program.repository'

/** A failure as Drizzle throws it: the driver's error, with its SQLSTATE, as the cause. */
function queryFailure(code: string, message: string): Error {
  return new Error('Failed query: insert into "goal_subject_assignments"', {
    cause: Object.assign(new Error(message), { code }),
  })
}

const DEADLOCK = (): Error => queryFailure('40P01', 'deadlock detected')
const CONFLICT = (): Error =>
  queryFailure('23P01', 'conflicting key value violates exclusion constraint')

/** A database whose transactions end, one after another, as `outcomes` say. */
function databaseEnding(outcomes: ReadonlyArray<Error | 'commits'>) {
  const transaction = vi.fn()
  for (const outcome of outcomes) {
    if (outcome === 'commits') transaction.mockResolvedValueOnce(undefined)
    else transaction.mockRejectedValueOnce(outcome)
  }
  return { db: { transaction } as unknown as Database, transaction }
}

// The fake never runs the transaction's body, so the bundle is never read.
const input = {
  bundle: {} as unknown as GoalProgramBundle,
  auditAction: 'goal_program.created',
}

describe('Goal Program create, when another create races it for the subject', () => {
  it('runs a deadlock victim again, and the second attempt is refused subject_has_goal', async () => {
    const { db, transaction } = databaseEnding([DEADLOCK(), CONFLICT()])

    await expect(createGoalProgramRepository(db).create(input)).resolves.toBe(
      'subject_has_goal',
    )
    expect(transaction).toHaveBeenCalledTimes(2)
  })

  it('creates the goal when the second attempt meets no other goal', async () => {
    const { db, transaction } = databaseEnding([DEADLOCK(), 'commits'])

    await expect(createGoalProgramRepository(db).create(input)).resolves.toBe('created')
    expect(transaction).toHaveBeenCalledTimes(2)
  })

  it('a second deadlock is not run a third time: it fails as it is', async () => {
    const { db, transaction } = databaseEnding([DEADLOCK(), DEADLOCK()])

    await expect(createGoalProgramRepository(db).create(input)).rejects.toMatchObject({
      cause: { code: '40P01' },
    })
    expect(transaction).toHaveBeenCalledTimes(2)
  })

  it('any other failure is not run again', async () => {
    const failure = queryFailure('23503', 'insert violates foreign key constraint')
    const { db, transaction } = databaseEnding([failure])

    await expect(createGoalProgramRepository(db).create(input)).rejects.toBe(failure)
    expect(transaction).toHaveBeenCalledOnce()
  })

  it('a conflict on the first attempt is refused at once', async () => {
    const { db, transaction } = databaseEnding([CONFLICT()])

    await expect(createGoalProgramRepository(db).create(input)).resolves.toBe(
      'subject_has_goal',
    )
    expect(transaction).toHaveBeenCalledOnce()
  })
})
