import { describe, expect, it, vi } from 'vitest'
import type { GovernedGoalRepository } from '../../application/ports/governed-goal.repository'
import {
  refreshGovernedGoalsFromReading,
  runGovernedGoalCloseSchedule,
} from './governed-goal.jobs'

const repository = {
  getDefinitionScope: vi.fn(),
  getDefinition: vi.fn(),
  getCurrentVersion: vi.fn(),
  getPeriod: vi.fn(),
  getLatestEvaluation: vi.fn(),
  listForProperty: vi.fn(),
  createDefinition: vi.fn(),
  reviseDefinition: vi.fn(),
  changeDefinitionStatus: vi.fn(),
  appendEvaluation: vi.fn(),
  appendTimezoneVersion: vi.fn(),
  enumerateActiveScopes: vi.fn(),
  enumerateActiveScopesForProperty: vi.fn(),
  enumerateDueScopes: vi.fn(),
  listOpenPeriods: vi.fn(),
} satisfies GovernedGoalRepository

describe('governed Goal delayed entry authorization', () => {
  it('enumerates tenant-cross targets but authorizes each concrete property before reads', async () => {
    repository.enumerateDueScopes.mockResolvedValueOnce([
      { organizationId: 'org-1', propertyId: 'p-1', definitionId: 'goal-1' },
      { organizationId: 'org-2', propertyId: 'p-2', definitionId: 'goal-2' },
    ])
    const authorize = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('suspended'))
    repository.listOpenPeriods.mockResolvedValueOnce([])
    const aggregates = { read: vi.fn() }

    const result = await runGovernedGoalCloseSchedule({
      repository,
      policy: { authorize },
      service: { evaluate: vi.fn() } as never,
      aggregates,
      now: new Date('2026-02-01T00:00:00Z'),
    })

    expect(result).toEqual({ closed: 0, denied: 1, failed: 0 })
    expect(repository.listOpenPeriods).toHaveBeenCalledTimes(1)
    expect(repository.listOpenPeriods).toHaveBeenCalledWith(
      'org-1',
      'p-1',
      'goal-1',
      new Date(0),
    )
    expect(aggregates.read).not.toHaveBeenCalled()
  })

  it('stops event refresh before enumerating definitions when policy is suspended', async () => {
    const result = await refreshGovernedGoalsFromReading({
      repository,
      policy: { authorize: vi.fn().mockRejectedValue(new Error('disabled')) },
      service: { evaluate: vi.fn() } as never,
      organizationId: 'org-1',
      propertyId: 'p-1',
      sourceEventId: 'reading-event-1',
      reading: {
        definitionVersionId: 'metric-version-1',
        dataQuality: 'eligible',
        exactValue: 1,
        numerator: null,
        denominator: null,
        sampleCount: 1,
        sourcePolicy: 'portal_manager_action',
      },
      watermark: new Date('2026-01-01T00:00:00Z'),
    })

    expect(result).toEqual({ evaluated: 0, denied: true })
    expect(repository.enumerateActiveScopesForProperty).not.toHaveBeenCalled()
  })
})
