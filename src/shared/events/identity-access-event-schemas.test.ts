import { beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import { registerAllEventSchemas } from './schema-registrations'
import { clearEventSchemas, validateEventPayload } from './schema-registry'

const PROPERTY_A = '11111111-1111-4111-8111-111111111111'
const PROPERTY_B = '22222222-2222-4222-8222-222222222222'

describe('registered identity access schemas', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  describe('identity.invitation.accepted', () => {
    const accepted = {
      organizationId: 'organization-1',
      userId: 'user-joined',
      invitationId: 'invitation-1',
    } as const

    it('keeps the inviter, identifiers only', () => {
      expect(
        validateEventPayload('identity.invitation.accepted', 1, {
          ...accepted,
          inviterId: 'user-inviter',
          email: 'must-not-enter@example.com',
        }),
      ).toEqual({ ...accepted, inviterId: 'user-inviter' })
    })

    it('still reads a fact recorded before the inviter was added', () => {
      expect(validateEventPayload('identity.invitation.accepted', 1, accepted)).toEqual(
        accepted,
      )
    })
  })

  describe('identity.member.property_access_changed', () => {
    const changed = {
      organizationId: 'organization-1',
      memberUserId: 'user-manager',
      userId: 'user-admin',
      grantedPropertyIds: [PROPERTY_A],
      revokedPropertyIds: [PROPERTY_B],
    } as const

    it('retains only who changed which Properties for whom', () => {
      expect(
        validateEventPayload('identity.member.property_access_changed', 1, {
          ...changed,
          propertyNames: ['must not enter the durable fact'],
        }),
      ).toEqual(changed)
    })

    it.each([
      ['a non-UUID Property', { grantedPropertyIds: ['property-1'] }],
      ['a missing member', { memberUserId: undefined }],
      [
        'more than 200 Properties',
        { revokedPropertyIds: Array.from({ length: 201 }, () => PROPERTY_B) },
      ],
    ])('rejects %s', (_label, override) => {
      expect(() =>
        validateEventPayload('identity.member.property_access_changed', 1, {
          ...changed,
          ...override,
        }),
      ).toThrowError(ZodError)
    })
  })
})
