// Identity context — accept invitation fact mapping
// The invitation table forbids a row with no inviter, so the real store cannot
// produce one; the port still types the inviter as nullable, and the use case
// must then leave it off the accepted fact. A store stub covers that mapping.

import { describe, it, expect, vi } from 'vitest'
import { acceptInvitation } from './accept-invitation.server'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import type { IdentityCommandStore } from '../application/ports/identity-command-store.port'
import { invitationId, userId, organizationId } from '#/shared/domain/ids'
import type { DomainEvent } from '#/shared/events/events'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

describe('acceptInvitation without an inviter on the row', () => {
  it('leaves the inviter off the accepted fact', async () => {
    const identity = createInMemoryIdentityPort()
    identity.setSessionUser({ id: 'user-orphan', email: 'orphan@test.com' })
    const built: DomainEvent[] = []
    const commandStore = {
      acceptInvitation: async (command) => {
        const accepted = {
          organizationId: organizationId('org-joined'),
          propertyIds: ['a1000000-0000-4000-8000-00000000000a'],
          inviterId: null,
        }
        built.push(command.buildEvent(accepted))
        return { ...accepted, ungrantedPropertyIds: [] }
      },
    } as Pick<IdentityCommandStore, 'acceptInvitation'> as IdentityCommandStore

    await acceptInvitation({
      identity,
      commandStore,
      invitations: { findOrganizationId: async () => organizationId('org-joined') },
      authorizeOrganization: async () => true,
      clock: () => FIXED_TIME,
      logger: { error: vi.fn() },
    })({
      invitationId: invitationId('inv-no-inviter'),
      headers: new Headers(),
      userId: userId('user-orphan'),
    })

    expect(built).toHaveLength(1)
    expect(built[0]?._tag).toBe('identity.invitation.accepted')
    expect((built[0] as { inviterId?: unknown }).inviterId).toBeUndefined()
  })
})
