import { describe, expect, it } from 'vitest'
import { organizationId } from '#/shared/domain/ids'
import { opsActorId, opsPublicationContext } from './portal-ops-actor'

const ORG = organizationId('org-ops-actor-0000000000000000001')

describe('portal ops actor', () => {
  it('records the operator as an ops actor, never as a user identifier', () => {
    expect(opsActorId('denev')).toBe('ops:denev')
    expect(opsActorId('denev@kodes.agency')).toBe('ops:denev@kodes.agency')
  })

  it.each(['', ' ', 'a b', 'x;y', '-lead', 'a'.repeat(200), 'tab\tname'])(
    'refuses an operator identity that the activity history could not record (%j)',
    (operator) => {
      expect(() => opsActorId(operator)).toThrow('operator identity')
    },
  )

  it('runs with organisation-wide Portal authority in the one organisation', () => {
    expect(opsPublicationContext(ORG, 'denev')).toEqual({
      userId: 'ops:denev',
      organizationId: ORG,
      role: 'AccountAdmin',
    })
  })
})
