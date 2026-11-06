import { describe, expect, it, vi } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import type { GoalProgramBundle } from '../application/ports/goal-program.repository'
import { propertyGoal } from '../application/use-cases/monthly-portal-goal-test-fixtures'
import { assignmentValues, versionValues } from './repositories/goal-program.rows'
import { assertPropertyCountGoalAvailable } from './repositories/property-count-goal-guard'

function transactionReading(bundles: readonly GoalProgramBundle[]) {
  const rows = bundles.flatMap(({ version, assignments }) =>
    assignments.map((assignment) => ({
      version: versionValues(version),
      assignment: assignmentValues(assignment),
    })),
  )
  const where = vi.fn(async () => rows)
  const query = {
    from: () => query,
    innerJoin: () => query,
    leftJoin: () => query,
    where,
  }
  return { tx: { select: () => query } as unknown as Tx, where }
}

const ratings = propertyGoal('ratings', 'portal_rating_count')
const scans = propertyGoal('scans', 'qualified_scans')
const average = propertyGoal('average', 'portal_rating_average')
const portal = propertyGoal('portal', 'qualified_scans', {
  subject: { kind: 'portal', portalId: 'reception' },
})
const several: GoalProgramBundle = {
  ...scans,
  assignments: [
    ...scans.assignments,
    {
      ...scans.assignments[0]!,
      id: 'second-assignment',
      subject: { kind: 'portal', portalId: 'reception' },
    },
  ],
}

describe('Property count goal identity at persistence', () => {
  it.each([
    [ratings, scans],
    [scans, ratings],
  ])('refuses the other count measure', async (candidate, stored) => {
    const { tx } = transactionReading([stored])
    await expect(
      assertPropertyCountGoalAvailable(tx, candidate.version, candidate.assignments),
    ).rejects.toMatchObject({ code: 'subject_has_goal' })
  })

  it.each([average, portal, several])(
    'does not reserve the identity for $program.id',
    async (candidate) => {
      const { tx, where } = transactionReading([ratings])
      await expect(
        assertPropertyCountGoalAvailable(tx, candidate.version, candidate.assignments),
      ).resolves.toBeUndefined()
      expect(where).not.toHaveBeenCalled()
    },
  )

  it('does not treat stored averages, Portal goals or several subjects as a Property count goal', async () => {
    const { tx } = transactionReading([average, portal, several])
    await expect(
      assertPropertyCountGoalAvailable(tx, ratings.version, ratings.assignments),
    ).resolves.toBeUndefined()
  })

  it('counts only current assignments when a revision replaces several subjects with the Property alone', async () => {
    const { tx } = transactionReading([ratings])
    const historical = { ...portal.assignments[0]!, programVersionId: 'old-version' }
    await expect(
      assertPropertyCountGoalAvailable(tx, scans.version, [
        ...scans.assignments,
        historical,
      ]),
    ).rejects.toMatchObject({ code: 'subject_has_goal' })
  })
})
