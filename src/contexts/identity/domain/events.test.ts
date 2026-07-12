import { describe, it, expect } from 'vitest'

import { identityOrganizationCreated, identityMemberInvited } from './events'
import { organizationId, userId, invitationId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'

const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')
const INV_ID = invitationId('inv-1')
const NOW = new Date('2026-06-01T12:00:00Z')

describe('identity events', () => {
  it('identityOrganizationCreated generates eventId and sets occurredAt', () => {
    const event = identityOrganizationCreated({
      organizationId: ORG_ID,
      organizationName: 'Test Org',
      slug: 'test-org',
      ownerId: USER_ID,
      occurredAt: NOW,
    })
    expect(event.eventId).toBeDefined()
    expect(event._tag).toBe('identity.organization.created')
    expect(event.occurredAt).toBe(NOW)
  })

  it('identityMemberInvited works', () => {
    const event = identityMemberInvited({
      organizationId: ORG_ID,
      userId: USER_ID,
      email: 'test@example.com',
      role: 'Staff' as Role,
      invitationId: INV_ID,
      occurredAt: NOW,
    })
    expect(event._tag).toBe('identity.member.invited')
  })

  it('throws/asserts for invalid occurredAt', () => {
    expect(() =>
      identityOrganizationCreated({
        organizationId: ORG_ID,
        organizationName: 'Test',
        slug: 'test',
        ownerId: USER_ID,
        occurredAt: 'not-date' as unknown as Date,
      }),
    ).toThrow()
  })
})
