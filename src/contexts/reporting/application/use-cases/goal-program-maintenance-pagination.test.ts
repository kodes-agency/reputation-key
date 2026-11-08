import { describe, expect, it, vi } from 'vitest'
import {
  createGoalProgramService,
  GoalProgramError,
  type GoalProgramDependencies,
} from '../../monthly-goals/goal-programs.server'
import {
  propertyGoal,
  NOV_1,
  DEC_1,
} from '../../monthly-goals/monthly-portal-goal.test-fixtures'

const now = new Date('2026-12-02T12:00:00Z')

describe('Goal maintenance paging', () => {
  it('advances past a full page of denied Programs to the next tenant', async () => {
    const first = Array.from({ length: 100 }, (_, index) =>
      propertyGoal(`goal-${index}`, 'qualified_scans'),
    )
    const next = propertyGoal('other-tenant', 'qualified_scans')
    const last = first[99]!.program
    const listOperational = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([
        { ...next, program: { ...next.program, organizationId: 'org-2' } },
      ])
    const authorize = vi.fn(async () => {
      throw new GoalProgramError('forbidden')
    })
    const service = createGoalProgramService({
      repository: { listOperational, listDueResults: async () => [] },
      policy: { authorize },
      now: () => now,
    } as unknown as GoalProgramDependencies)

    await expect(service.maintain()).resolves.toMatchObject({
      inspected: 101,
      denied: 101,
      failed: 0,
    })
    expect(listOperational.mock.calls).toEqual([
      [],
      [{ organizationId: last.organizationId, propertyId: last.propertyId, id: last.id }],
    ])
    expect(authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: 'org-2' }),
    )
  })

  it('advances past due results that raced or are denied without retrying them in the same pass', async () => {
    const results = Array.from(
      { length: 101 },
      (_, index) =>
        propertyGoal(`goal-${index}`, 'qualified_scans', {
          months: [{ start: NOV_1, end: DEC_1 }],
        }).results[0]!,
    )
    const last = results[99]!
    const listDueResults = vi
      .fn()
      .mockResolvedValueOnce(results.slice(0, 100))
      .mockResolvedValueOnce(results.slice(100))
    const getDueResult = vi.fn(async (_org, _property, id: string) =>
      id === results[0]!.id ? null : results.find((result) => result.id === id),
    )
    const service = createGoalProgramService({
      repository: { listOperational: async () => [], listDueResults, getDueResult },
      policy: {
        authorize: async () => {
          throw new GoalProgramError('forbidden')
        },
      },
      now: () => now,
    } as unknown as GoalProgramDependencies)

    await expect(service.maintain()).resolves.toMatchObject({
      denied: 100,
      raced: 1,
      failed: 0,
    })
    expect(listDueResults.mock.calls).toEqual([
      [now],
      [now, { periodEnd: last.periodEnd, id: last.id }],
    ])
    expect(getDueResult).toHaveBeenCalledTimes(101)
  })

  it('reports failures from earlier pages after attempting later due results', async () => {
    const result = propertyGoal('goal', 'qualified_scans', {
      months: [{ start: NOV_1, end: DEC_1 }],
    }).results[0]!
    const first = Array.from({ length: 100 }, (_, index) => ({
      ...result,
      id: `result-${index}`,
    }))
    const listDueResults = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([{ ...result, id: 'later-result', organizationId: 'org-2' }])
    const getDueResult = vi.fn(async (org) => {
      if (org === 'org-2') return null
      throw new TypeError('unavailable')
    })
    const service = createGoalProgramService({
      repository: { listOperational: async () => [], listDueResults, getDueResult },
      now: () => now,
    } as unknown as GoalProgramDependencies)

    await expect(service.maintain()).rejects.toMatchObject({
      name: 'GoalProgramMaintenanceError',
      stats: { failed: 100, raced: 1, failureCauses: { TypeError: 100 } },
    })
    expect(getDueResult).toHaveBeenLastCalledWith(
      'org-2',
      result.propertyId,
      'later-result',
      now,
    )
  })

  it('finishes when the page after an exact multiple is empty', async () => {
    const first = Array.from({ length: 100 }, (_, index) =>
      propertyGoal(`goal-${index}`, 'qualified_scans'),
    )
    const listOperational = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce([])
    const service = createGoalProgramService({
      repository: { listOperational, listDueResults: async () => [] },
      policy: {
        authorize: async () => {
          throw new GoalProgramError('forbidden')
        },
      },
      now: () => now,
    } as unknown as GoalProgramDependencies)

    await expect(service.maintain()).resolves.toMatchObject({
      inspected: 100,
      denied: 100,
    })
    expect(listOperational).toHaveBeenCalledTimes(2)
  })
})
