// Member Property access server functions, called as signed-in members over
// PostgreSQL with the real tenant resolution, execution policy and store.

import { describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type TestMember,
  type TestProperty,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  listMemberPropertyAccess,
  setMemberPropertyAccess,
} from './organizations.member-access'
import { listPropertyResponsibleManagers } from '#/contexts/property/server/property-responsible-managers'

const harness = setupServerFunctionHarness()

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  return { organization, admin, manager, property }
}

const memberRowId = (member: TestMember) => `member-${member.userId}`

const managerReadsProperty = (manager: TestMember, property: TestProperty) =>
  harness.callAs(manager, () =>
    listPropertyResponsibleManagers({ data: { propertyId: property.id } }),
  )

async function activeGrants(member: TestMember, property: TestProperty) {
  const { rows } = await harness.pool().query(
    `SELECT 1 FROM property_access_grant
     WHERE property_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [property.id, member.userId],
  )
  return rows.length
}

describe('listMemberPropertyAccess', () => {
  it('lists the Properties each PropertyManager can work, to an AccountAdmin', async () => {
    const { admin, manager, property } = await hotel()
    await harness.grantProperty(manager, property)

    const listed = await harness.callAs(admin, () => listMemberPropertyAccess())

    expect(listed.access).toContainEqual({
      userId: manager.userId,
      propertyIds: [property.id],
    })
  })

  it("never lists another Organization's members", async () => {
    const { admin } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'PropertyManager')
    const foreign = await harness.seedProperty(elsewhere)
    await harness.grantProperty(stranger, foreign)

    const listed = await harness.callAs(admin, () => listMemberPropertyAccess())

    expect(listed.access.map((row) => row.userId)).not.toContain(stranger.userId)
  })

  it('refuses a PropertyManager, a staff-only login and a caller with no session', async () => {
    const { organization, manager } = await hotel()
    const staff = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(manager, () => listMemberPropertyAccess()),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })
    await expect(
      harness.callAs(staff, () => listMemberPropertyAccess()),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    await expect(
      harness.callAs(null, () => listMemberPropertyAccess()),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })
})

describe('setMemberPropertyAccess', () => {
  it('grants and then revokes a Property and answers what changed', async () => {
    const { admin, manager, property } = await hotel()

    const granted = await harness.callAs(admin, () =>
      setMemberPropertyAccess({
        data: { memberId: memberRowId(manager), grantPropertyIds: [property.id] },
      }),
    )

    expect(granted).toMatchObject({
      grantedPropertyIds: [property.id],
      revokedPropertyIds: [],
    })
    expect(await activeGrants(manager, property)).toBe(1)

    const revoked = await harness.callAs(admin, () =>
      setMemberPropertyAccess({
        data: { memberId: memberRowId(manager), revokePropertyIds: [property.id] },
      }),
    )

    expect(revoked).toMatchObject({
      grantedPropertyIds: [],
      revokedPropertyIds: [property.id],
    })
    expect(await activeGrants(manager, property)).toBe(0)
  })

  it('shows a PropertyManager the new scope on their next request, after a grant and after a revoke', async () => {
    const { admin, manager, property } = await hotel()
    // The manager's request before the grant is served and cached.
    await expect(managerReadsProperty(manager, property)).rejects.toMatchObject({
      code: 'scope_denied',
      status: 403,
    })

    await harness.callAs(admin, () =>
      setMemberPropertyAccess({
        data: { memberId: memberRowId(manager), grantPropertyIds: [property.id] },
      }),
    )
    await expect(managerReadsProperty(manager, property)).resolves.toMatchObject({
      assignments: [],
    })

    await harness.callAs(admin, () =>
      setMemberPropertyAccess({
        data: { memberId: memberRowId(manager), revokePropertyIds: [property.id] },
      }),
    )
    await expect(managerReadsProperty(manager, property)).rejects.toMatchObject({
      code: 'scope_denied',
      status: 403,
    })
  })

  it('refuses a change for an AccountAdmin, who can already reach every Property', async () => {
    const { organization, admin, property } = await hotel()
    const otherAdmin = await harness.seedMember(organization, 'AccountAdmin')

    await expect(
      harness.callAs(admin, () =>
        setMemberPropertyAccess({
          data: { memberId: memberRowId(otherAdmin), grantPropertyIds: [property.id] },
        }),
      ),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'validation_error',
      status: 400,
    })
    expect(await activeGrants(otherAdmin, property)).toBe(0)
  })

  it('refuses a Property of another Organization and writes nothing', async () => {
    const { admin, manager } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const foreign = await harness.seedProperty(elsewhere)

    await expect(
      harness.callAs(admin, () =>
        setMemberPropertyAccess({
          data: { memberId: memberRowId(manager), grantPropertyIds: [foreign.id] },
        }),
      ),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'validation_error',
      status: 400,
      message: 'A selected property is not in this organization',
    })
    expect(await activeGrants(manager, foreign)).toBe(0)
  })

  it('does not change a member of another Organization', async () => {
    const { admin, property } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'PropertyManager')

    await expect(
      harness.callAs(admin, () =>
        setMemberPropertyAccess({
          data: { memberId: memberRowId(stranger), grantPropertyIds: [property.id] },
        }),
      ),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'member_not_found',
      status: 404,
    })
    expect(await activeGrants(stranger, property)).toBe(0)
  })

  it('refuses an empty change and a Property both granted and revoked', async () => {
    const { admin, manager, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        setMemberPropertyAccess({ data: { memberId: memberRowId(manager) } as never }),
      ),
    ).rejects.toThrow(/at least one Property/)
    await expect(
      harness.callAs(admin, () =>
        setMemberPropertyAccess({
          data: {
            memberId: memberRowId(manager),
            grantPropertyIds: [property.id],
            revokePropertyIds: [property.id],
          },
        }),
      ),
    ).rejects.toThrow(/granted and revoked/)
  })

  it('refuses a PropertyManager, a staff-only login and a caller with no session', async () => {
    const { organization, manager, property } = await hotel()
    const staff = await harness.seedMember(organization, 'Member')
    const data = { memberId: memberRowId(manager), grantPropertyIds: [property.id] }

    await expect(
      harness.callAs(manager, () => setMemberPropertyAccess({ data })),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })
    await expect(
      harness.callAs(staff, () => setMemberPropertyAccess({ data })),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    await expect(
      harness.callAs(null, () => setMemberPropertyAccess({ data })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    expect(await activeGrants(manager, property)).toBe(0)
  })
})
