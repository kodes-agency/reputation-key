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
        previousRole: 'Staff',
        newRole: 'PropertyManager',
      },
      expected: 'changed-user',
    },
    {
      eventType: 'identity.member.removed' as const,
      payload: { organizationId: ORG, userId: 'removed-user' },
      expected: 'removed-user',
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
        previousRole: 'Staff',
        newRole: 'PropertyManager',
      },
    })

    expect(target).not.toBe(userId('admin-actor'))
    expect(target).toBe(userId('changed-user'))
  })
})
