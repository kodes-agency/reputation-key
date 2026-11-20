// Accepting an invitation, called by a signed-in user who is not yet a member,
// over PostgreSQL with the real identity adapter and execution policy.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { acceptInvitation } from './organizations.invitations'

const PAUSED = 'org-harness-invitations-paused'

const harness = setupServerFunctionHarness({ env: { BETA_SUSPENDED_ORGS: PAUSED } })

async function invitationFor(organizationId?: string) {
  const organization = await harness.seedOrganization(
    organizationId ? { id: organizationId } : {},
  )
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const invitee = await harness.seedVisitor()
  const invitation = await harness.seedInvitation(organization, {
    inviter: admin,
    email: invitee.email,
    role: 'AccountAdmin',
  })
  return { organization, invitee, invitation }
}

async function memberRoles(userId: string): Promise<string[]> {
  const { rows } = await harness
    .pool()
    .query<{ role: string }>(`SELECT role FROM member WHERE "userId" = $1`, [userId])
  return rows.map((row) => row.role)
}

describe('acceptInvitation', () => {
  it('makes the invitee a member of the Organization', async () => {
    const { invitee, invitation } = await invitationFor()

    await harness.callAs(invitee, () =>
      acceptInvitation({ data: { invitationId: invitation.id } }),
    )

    expect(await memberRoles(invitee.userId)).toEqual(['owner'])
  })

  it('answers an unknown or expired link with 404', async () => {
    const invitee = await harness.seedVisitor()

    await expect(
      harness.callAs(invitee, () =>
        acceptInvitation({
          data: { invitationId: '0198db6a-dc93-7d85-aa08-d75669070e80' },
        }),
      ),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'invitation_not_found',
      status: 404,
    })
    expect(await memberRoles(invitee.userId)).toEqual([])
  })

  it('answers a stopped Organization with 403 and the fixed copy', async () => {
    const { invitee, invitation } = await invitationFor(PAUSED)

    await expect(
      harness.callAs(invitee, () =>
        acceptInvitation({ data: { invitationId: invitation.id } }),
      ),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'forbidden',
      status: 403,
      message: 'This invitation cannot be accepted right now. Try again later.',
    })
    expect(await memberRoles(invitee.userId)).toEqual([])
  })

  it('refuses a caller with no session', async () => {
    const { invitation } = await invitationFor()

    await expect(
      harness.callAs(null, () =>
        acceptInvitation({ data: { invitationId: invitation.id } }),
      ),
    ).rejects.toMatchObject({ status: 401 })
  })
})
