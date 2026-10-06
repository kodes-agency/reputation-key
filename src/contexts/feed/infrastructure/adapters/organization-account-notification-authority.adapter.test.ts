import { beforeEach, describe, expect, it } from 'vitest'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, userId } from '#/shared/domain/ids'
import { affectedUserFromIdentityFact } from './organization-account-notification-authority.adapter'

const ORG = organizationId('org-account-notice')

describe('Organization account notification durable authority', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  it.each([
    {
      eventType: 'identity.invitation.accepted' as const,
      payload: {
        organizationId: ORG,
        userId: 'joined-user',
        invitationId: 'invitation-1',
      },
      expected: 'joined-user',
    },
    {
      eventType: 'identity.member.role_changed' as const,
      payload: {
        organizationId: ORG,
        userId: 'admin-actor',
        memberUserId: 'changed-user',
        previousRole: 'Member',
        newRole: 'PropertyManager',
      },
      expected: 'changed-user',
    },
    {
      eventType: 'identity.member.removed' as const,
      payload: { organizationId: ORG, userId: 'removed-user' },
      expected: 'removed-user',
    },
    {
      eventType: 'identity.member.property_access_changed' as const,
      payload: {
        organizationId: ORG,
        userId: 'admin-actor',
        memberUserId: 'manager-user',
        grantedPropertyIds: ['4d1f0c1e-2b7a-4c55-9a51-000000000001'],
        revokedPropertyIds: [],
      },
      expected: 'manager-user',
    },
  ])(
    'resolves the affected account from $eventType',
    ({ eventType, payload, expected }) => {
      expect(
        affectedUserFromIdentityFact({
          eventType,
          eventVersion: 1,
          organizationId: ORG,
          payload,
        }),
      ).toBe(userId(expected))
    },
  )

  it('rejects an envelope/payload Organization mismatch', () => {
    expect(() =>
      affectedUserFromIdentityFact({
        eventType: 'identity.member.removed',
        eventVersion: 1,
        organizationId: ORG,
        payload: { organizationId: 'another-org', userId: 'removed-user' },
      }),
    ).toThrow('attribution mismatch')
  })

  it('uses the role-change target, never the actor', () => {
    const target = affectedUserFromIdentityFact({
      eventType: 'identity.member.role_changed',
      eventVersion: 1,
      organizationId: ORG,
      payload: {
        organizationId: ORG,
        userId: 'admin-actor',
        memberUserId: 'changed-user',
        previousRole: 'Member',
        newRole: 'PropertyManager',
      },
    })

    expect(target).not.toBe(userId('admin-actor'))
    expect(target).toBe(userId('changed-user'))
  })

  it('uses the property-access target, never the AccountAdmin who changed it', () => {
    const payload = {
      organizationId: ORG,
      userId: 'admin-actor',
      memberUserId: 'manager-user',
      grantedPropertyIds: [],
      revokedPropertyIds: ['4d1f0c1e-2b7a-4c55-9a51-000000000001'],
    }

    const target = affectedUserFromIdentityFact({
      eventType: 'identity.member.property_access_changed',
      eventVersion: 1,
      organizationId: ORG,
      payload,
    })

    expect(target).toBe(userId('manager-user'))
    expect(target).not.toBe(userId('admin-actor'))
  })

  it('refuses a property-access fact that names no target', () => {
    expect(() =>
      affectedUserFromIdentityFact({
        eventType: 'identity.member.property_access_changed',
        eventVersion: 1,
        organizationId: ORG,
        payload: {
          organizationId: ORG,
          userId: 'admin-actor',
          grantedPropertyIds: [],
          revokedPropertyIds: [],
        },
      }),
    ).toThrow(/memberUserId/)
  })
})
