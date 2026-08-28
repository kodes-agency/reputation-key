import { describe, expect, it } from 'vitest'
import { organizationId, propertyId, teamId } from '#/shared/domain/ids'
import { teamCreated, teamDeleted, teamUpdated } from './events'

const SCOPE = {
  teamId: teamId('team-1'),
  organizationId: organizationId('organization-1'),
  propertyId: propertyId('property-1'),
  occurredAt: new Date('2026-08-27T12:00:00.000Z'),
} as const

describe('Team events', () => {
  it('preserves caller correlation across every constructor', () => {
    const correlationId = 'correlation-1'

    expect(teamCreated({ ...SCOPE, name: 'Front desk', correlationId })).toMatchObject({
      correlationId,
    })
    expect(
      teamUpdated({ ...SCOPE, name: 'Guest services', correlationId }),
    ).toMatchObject({ correlationId })
    expect(teamDeleted({ ...SCOPE, correlationId })).toMatchObject({ correlationId })
  })

  it('uses an explicit null when correlation is absent', () => {
    expect(teamCreated({ ...SCOPE, name: 'Front desk' }).correlationId).toBeNull()
    expect(teamUpdated({ ...SCOPE, name: 'Guest services' }).correlationId).toBeNull()
    expect(teamDeleted(SCOPE).correlationId).toBeNull()
  })
})
