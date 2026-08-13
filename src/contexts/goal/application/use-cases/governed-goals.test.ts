import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GovernedGoalRepository } from '../ports/governed-goal.repository'
import {
  createGovernedGoalService,
  GovernedGoalError,
  type GoalActor,
} from './governed-goals'

const manager: GoalActor = {
  organizationId: 'org-1',
  userId: 'manager-1',
  role: 'PropertyManager',
}
const staff: GoalActor = {
  organizationId: 'org-1',
  userId: 'staff-1',
  role: 'Staff',
}
const metric = {
  definitionId: 'metric-definition-1',
  versionId: 'metric-version-1',
  metricKey: 'portal.configuration_completeness',
  valueKind: 'level' as const,
  allowedScopes: ['property', 'portal_group'],
  sourcePolicyAllowlist: ['portal_configuration'],
  permittedConsumers: ['goal'],
  minimumSample: 1,
  employmentDecisionEligible: false,
}
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
  enumerateActiveScopesForProperty: vi.fn(),
  appendEvaluation: vi.fn(),
  appendTimezoneVersion: vi.fn(),
  enumerateActiveScopes: vi.fn(),
  enumerateDueScopes: vi.fn(),
  listOpenPeriods: vi.fn(),
} satisfies GovernedGoalRepository
const authorize = vi.fn()
let nextId = 0
const service = createGovernedGoalService({
  repository,
  policy: { authorize },
  properties: {
    getTimezone: vi.fn().mockResolvedValue('America/New_York'),
    portalGroupBelongsToProperty: vi.fn().mockResolvedValue(true),
  },
  metrics: { getApprovedVersion: vi.fn().mockResolvedValue(metric) },
  id: () => `id-${++nextId}`,
  now: () => new Date('2026-01-01T12:00:00Z'),
})

beforeEach(() => {
  vi.clearAllMocks()
  nextId = 0
})

describe('create governed Goal', () => {
  it('loads and snapshots the property timezone instead of accepting one from the client', async () => {
    await service.create(
      {
        propertyId: 'property-1',
        scope: { kind: 'property' },
        name: 'Configuration complete',
        metricDefinitionVersionId: metric.versionId,
        measureKind: 'level',
        targetValue: 90,
        sourcePolicy: 'portal_configuration',
        recurrenceRule: { frequency: 'monthly', interval: 1, dayOfMonth: 1 },
      },
      manager,
    )
    const command = repository.createDefinition.mock.calls[0]?.[0]
    expect(command?.version.propertyTimezone).toBe('America/New_York')
    expect(command?.version.metric.versionId).toBe('metric-version-1')
    expect(command?.period.propertyTimezone).toBe('America/New_York')
  })

  it('keeps Staff read-only even if a caller reaches the use case directly', async () => {
    await expect(
      service.create(
        {
          propertyId: 'property-1',
          scope: { kind: 'property' },
          name: 'Forbidden',
          metricDefinitionVersionId: metric.versionId,
          measureKind: 'level',
          targetValue: 90,
          sourcePolicy: 'portal_configuration',
          recurrenceRule: { frequency: 'monthly', interval: 1 },
        },
        staff,
      ),
    ).rejects.toEqual(new GovernedGoalError('forbidden'))
    expect(authorize).not.toHaveBeenCalled()
    expect(repository.createDefinition).not.toHaveBeenCalled()
  })
})

describe('evaluate governed Goal', () => {
  it('authorizes concrete property before loading period or reading data', async () => {
    authorize.mockRejectedValueOnce(new Error('suspended'))
    await expect(
      service.evaluate({
        organizationId: 'org-1',
        propertyId: 'property-1',
        periodId: 'period-1',
        sourceEventId: 'event-1',
        reading: null,
        watermark: new Date('2026-01-02T00:00:00Z'),
      }),
    ).rejects.toThrow('suspended')
    expect(repository.getPeriod).not.toHaveBeenCalled()
  })

  it('persists unavailable as a null-valued append-only evaluation', async () => {
    const period = {
      id: 'period-1',
      definitionId: 'definition-1',
      definitionVersionId: 'version-1',
      organizationId: 'org-1',
      propertyId: 'property-1',
      periodStart: new Date('2026-01-01T05:00:00Z'),
      periodEnd: new Date('2026-02-01T05:00:00Z'),
      propertyTimezone: 'America/New_York',
      status: 'open' as const,
      statusReason: null,
      evaluationWatermark: null,
      closedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }
    repository.getPeriod.mockResolvedValueOnce(period)
    repository.getCurrentVersion.mockResolvedValueOnce({
      id: 'version-1',
      definitionId: 'definition-1',
      organizationId: 'org-1',
      propertyId: 'property-1',
      version: 1,
      metric,
      measureKind: 'level',
      targetValue: 90,
      sourcePolicy: 'portal_configuration',
      propertyTimezone: 'America/New_York',
      recurrenceRule: { frequency: 'monthly', interval: 1 },
      effectiveFrom: period.periodStart,
      effectiveTo: null,
      changeReason: 'created',
      createdBy: 'manager-1',
      createdAt: period.createdAt,
    })
    repository.appendEvaluation.mockImplementationOnce(
      async ({ evaluation }) => evaluation,
    )
    const result = await service.evaluate({
      organizationId: 'org-1',
      propertyId: 'property-1',
      periodId: 'period-1',
      sourceEventId: 'event-unavailable',
      reading: null,
      watermark: new Date('2026-01-02T00:00:00Z'),
    })
    expect(result).toMatchObject({
      state: 'unavailable',
      value: null,
      achieved: false,
      idempotencyKey: 'goal-evaluation:period-1:event-unavailable',
    })
  })
})

describe('timezone change versioning', () => {
  it('schedules one future version at the existing period boundary and treats replay as duplicate', async () => {
    const definition = {
      id: 'definition-1',
      organizationId: 'org-1',
      propertyId: 'property-1',
      scope: { kind: 'property' as const },
      name: 'Configuration complete',
      description: null,
      status: 'active' as const,
      statusReason: null,
      currentVersion: 1,
      createdBy: 'manager-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }
    const period = {
      id: 'period-1',
      definitionId: definition.id,
      definitionVersionId: 'version-1',
      organizationId: 'org-1',
      propertyId: 'property-1',
      periodStart: new Date('2026-01-01T05:00:00Z'),
      periodEnd: new Date('2026-02-01T05:00:00Z'),
      propertyTimezone: 'America/New_York',
      status: 'open' as const,
      statusReason: null,
      evaluationWatermark: null,
      closedAt: null,
      createdAt: definition.createdAt,
      updatedAt: definition.updatedAt,
    }
    const version = {
      id: 'version-1',
      definitionId: definition.id,
      organizationId: 'org-1',
      propertyId: 'property-1',
      version: 1,
      metric,
      measureKind: 'level' as const,
      targetValue: 90,
      sourcePolicy: 'portal_configuration',
      propertyTimezone: 'America/New_York',
      recurrenceRule: { frequency: 'monthly' as const, interval: 1, dayOfMonth: 1 },
      effectiveFrom: period.periodStart,
      effectiveTo: null,
      changeReason: 'created',
      createdBy: 'manager-1',
      createdAt: definition.createdAt,
    }
    repository.getDefinition.mockResolvedValue(definition)
    repository.getCurrentVersion.mockResolvedValue(version)
    repository.listOpenPeriods.mockResolvedValue([period])
    repository.appendTimezoneVersion
      .mockResolvedValueOnce('applied')
      .mockResolvedValueOnce('duplicate')
    const command = {
      sourceEventId: 'timezone-event-1',
      organizationId: 'org-1',
      propertyId: 'property-1',
      propertyVersion: 2,
      newTimezone: 'America/Los_Angeles',
      effectiveAt: new Date('2026-01-15T12:00:00Z'),
      definitionId: definition.id,
    }
    expect(await service.applyTimezoneChange(command)).toBe('applied')
    expect(await service.applyTimezoneChange(command)).toBe('duplicate')
    const scheduled = repository.appendTimezoneVersion.mock.calls[0]?.[0]
    expect(scheduled?.version.effectiveFrom).toEqual(period.periodEnd)
    expect(scheduled?.period.periodStart).toEqual(period.periodEnd)
    expect(scheduled?.period.propertyTimezone).toBe('America/Los_Angeles')
  })
})
