// The Settings member directory, called as signed-in members over PostgreSQL
// with the real tenant resolution, execution policy and identity adapter.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { listMembers } from './organizations.query'

const harness = setupServerFunctionHarness()

describe('listMembers', () => {
  it('lists the managers with their directory fields and omits staff-only logins', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')
    const manager = await harness.seedMember(organization, 'PropertyManager')
    const staff = await harness.seedMember(organization, 'Member')

    const directory = await harness.callAs(admin, () => listMembers())

    expect(directory.requestingRole).toBe('AccountAdmin')
    const byUser = new Map(directory.members.map((m) => [m.userId, m]))
    expect([...byUser.keys()].sort()).toEqual([admin.userId, manager.userId].sort())
    expect(byUser.has(staff.userId)).toBe(false)
    expect(byUser.get(manager.userId)).toEqual({
      id: expect.any(String),
      userId: manager.userId,
      role: 'PropertyManager',
      rawRole: 'admin',
      email: manager.email,
      name: 'Harness Member',
      image: null,
      createdAt: expect.any(Date),
    })
  })

  it('answers a PropertyManager with their own role', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')
    const manager = await harness.seedMember(organization, 'PropertyManager')

    const directory = await harness.callAs(manager, () => listMembers())

    expect(directory.requestingRole).toBe('PropertyManager')
    expect(directory.members.map((m) => m.userId)).toContain(admin.userId)
  })

  it("never lists another Organization's members", async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'AccountAdmin')

    const directory = await harness.callAs(admin, () => listMembers())

    expect(directory.members.map((m) => m.userId)).not.toContain(stranger.userId)
  })

  it('refuses a staff-only login', async () => {
    const organization = await harness.seedOrganization()
    const staff = await harness.seedMember(organization, 'Member')

    await expect(harness.callAs(staff, () => listMembers())).rejects.toMatchObject({
      code: 'beta_role_inactive',
    })
  })

  it('refuses a caller with no session', async () => {
    await expect(harness.callAs(null, () => listMembers())).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })
})
