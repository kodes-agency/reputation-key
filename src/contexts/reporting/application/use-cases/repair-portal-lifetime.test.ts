import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { emptyPortalLifetimeValues } from '../../domain/portal-lifetime-aggregate'
import type {
  PortalLifetimeAggregate,
  PortalLifetimeAggregatePort,
  PortalLifetimeScope,
} from '../ports/portal-lifetime-aggregate.port'
import { repairPortalLifetime } from './repair-portal-lifetime'

const scope: PortalLifetimeScope = {
  organizationId: organizationId('org-metric-repair'),
  propertyId: propertyId('b1000000-0000-4000-8000-000000000001'),
  portalId: portalId('b2000000-0000-4000-8000-000000000001'),
}

const aggregate: PortalLifetimeAggregate = {
  ...scope,
  definitionVersionIds: {
    qualifiedScans: 'qualified-scans-v1',
    privateRatings: 'private-ratings-v1',
    privateFeedback: 'private-feedback-v1',
    destinationSelections: 'destination-selections-v1',
  },
  values: emptyPortalLifetimeValues(),
  sealedThroughLocalDate: null,
  projectionRevision: 4,
  lastRebuiltAt: null,
  lastSealedAt: null,
}

function lifetimePort(): PortalLifetimeAggregatePort {
  return {
    get: vi.fn(),
    inspect: vi.fn(async () => ({
      current: aggregate,
      expectedValues: { ...aggregate.values, qualifiedScanCount: 2 },
      matched: false,
    })),
    rebuild: vi.fn(async () => ({
      before: aggregate,
      after: {
        ...aggregate,
        values: { ...aggregate.values, qualifiedScanCount: 2 },
        projectionRevision: 5,
      },
      matched: false,
    })),
    sealThrough: vi.fn(),
  }
}

describe('repairPortalLifetime', () => {
  it('uses read-only inspection in report mode', async () => {
    const lifetime = lifetimePort()

    await expect(
      repairPortalLifetime({ lifetime }, { scope, mode: 'report' }),
    ).resolves.toMatchObject({
      mode: 'report',
      matchedBefore: false,
      changed: false,
      projectionRevision: 4,
    })
    expect(lifetime.inspect).toHaveBeenCalledWith(scope)
    expect(lifetime.rebuild).not.toHaveBeenCalled()
  })

  it('uses the fenced rebuild authority in apply mode', async () => {
    const lifetime = lifetimePort()

    await expect(
      repairPortalLifetime({ lifetime }, { scope, mode: 'apply' }),
    ).resolves.toMatchObject({
      mode: 'apply',
      matchedBefore: false,
      changed: true,
      projectionRevision: 5,
    })
    expect(lifetime.inspect).not.toHaveBeenCalled()
    expect(lifetime.rebuild).toHaveBeenCalledWith(scope)
  })
})
