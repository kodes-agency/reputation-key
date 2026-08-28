import { describe, expect, it } from 'vitest'
import { badgeId, organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { badgeAwarded } from './events'

const BASE = {
  organizationId: organizationId('organization-1'),
  propertyId: propertyId('property-1'),
  badgeDefinitionId: badgeId('badge-1'),
  criteriaVersion: 1,
  targetType: 'portal' as const,
  targetId: portalId('portal-1'),
  awardedAt: new Date('2026-08-27T12:00:00.000Z'),
  occurredAt: new Date('2026-08-27T12:00:00.000Z'),
} as const

describe('Badge events', () => {
  it('preserves caller correlation', () => {
    expect(badgeAwarded({ ...BASE, correlationId: 'correlation-1' })).toMatchObject({
      correlationId: 'correlation-1',
    })
  })

  it('uses an explicit null when correlation is absent', () => {
    expect(badgeAwarded(BASE).correlationId).toBeNull()
  })
})
