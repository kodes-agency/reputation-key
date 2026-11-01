import { describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Tx } from '#/shared/outbox/commit'
import type {
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../../application/ports/goal-program.repository'
import { assertPersonalGoalAssignments } from './personal-goal-assignment-guard'

describe('staff target commit guard', () => {
  it.each(['portal', 'portal_group'] as const)(
    'renders valid UUID predicates when only %s subjects are present',
    async (kind) => {
      const execute = vi.fn(async (_statement: SQL) => ({ rows: [] }))
      const assignment = {
        subject:
          kind === 'portal'
            ? { kind, portalId: '11111111-1111-4111-8111-111111111111' }
            : { kind, portalGroupId: '11111111-1111-4111-8111-111111111112' },
      } as GoalSubjectAssignment
      await assertPersonalGoalAssignments(
        { execute } as unknown as Tx,
        {
          organizationId: 'org',
          propertyId: '11111111-1111-4111-8111-111111111113',
          metric: 'portal_rating_count',
          effectiveFrom: new Date(),
        } as GoalProgramVersion,
        [assignment],
      )
      const query = new PgDialect().sqlToQuery(execute.mock.calls[1]![0])
      expect(query.sql).toContain('IN (NULL::uuid)')
      expect(query.sql).not.toContain('ANY(')
      expect(query.params).toContain(
        kind === 'portal'
          ? '11111111-1111-4111-8111-111111111111'
          : '11111111-1111-4111-8111-111111111112',
      )
    },
  )
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
