import { describe, expect, it, vi } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import type {
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../../application/ports/goal-program.repository'
import { assertPersonalGoalAssignments } from './personal-goal-assignment-guard'

describe('staff target commit guard', () => {
  it('refuses a personal Group inserted after the application preflight', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'personal' }] })
    const version = {
      organizationId: 'org',
      propertyId: 'property',
      metric: 'portal_rating_count',
      effectiveFrom: new Date(),
    } as GoalProgramVersion
    const assignment = {
      subject: { kind: 'portal_group', portalGroupId: 'group' },
    } as GoalSubjectAssignment
    await expect(
      assertPersonalGoalAssignments({ execute } as unknown as Tx, version, [assignment]),
    ).rejects.toMatchObject({ code: 'invalid_subject' })
    expect(execute).toHaveBeenCalledTimes(2)
  })
  it('allows scans while holding the same definition and membership lock', async () => {
    const execute = vi.fn(async () => ({ rows: [] }))
    await expect(
      assertPersonalGoalAssignments(
        { execute } as unknown as Tx,
        {
          organizationId: 'org',
          propertyId: 'property',
          metric: 'qualified_scans',
        } as GoalProgramVersion,
        [],
      ),
    ).resolves.toBeUndefined()
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
