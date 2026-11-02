import { it, expect, vi } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import type {
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../application/ports/goal-program.repository'
import { assertPersonalGoalAssignments } from './repositories/personal-goal-assignment-guard'
const version = (metric: GoalProgramVersion['metric']) =>
  ({
    organizationId: 'org',
    propertyId: 'p',
    effectiveFrom: new Date('2026-11-01T12:00:00Z'),
    metric,
  }) as GoalProgramVersion
const assignment = {
  subject: { kind: 'portal_group', portalGroupId: 'g' },
} as GoalSubjectAssignment
it.each(['portal_rating_count', 'portal_rating_average'] as const)(
  'refuses %s on a group with a person',
  async (metric) => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ kind: 'personal', skip_private_rating: false }] })
    await expect(
      assertPersonalGoalAssignments({ execute } as unknown as Tx, version(metric), [
        assignment,
      ]),
    ).rejects.toMatchObject({ code: 'staff_scan_only' })
  },
)
it('refuses scans when any group portal skips ratings', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [
        { kind: 'personal', skip_private_rating: false },
        { kind: 'place', skip_private_rating: true },
      ],
    })
  await expect(
    assertPersonalGoalAssignments(
      { execute } as unknown as Tx,
      version('qualified_scans'),
      [assignment],
    ),
  ).rejects.toMatchObject({ code: 'staff_private_ratings_skipped' })
})
it('allows compatible scans while holding the same fence', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ kind: 'personal', skip_private_rating: false }] })
  await expect(
    assertPersonalGoalAssignments(
      { execute } as unknown as Tx,
      version('qualified_scans'),
      [assignment],
    ),
  ).resolves.toBeUndefined()
  expect(execute).toHaveBeenCalledTimes(2)
})
