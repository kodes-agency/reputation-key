// The staff management server functions, called as signed-in members over
// PostgreSQL with the real tenant resolution and execution policy: who may
// manage staff at a Property, that a refusal changes nothing, and that a staff
// member of another Organization is not found.

import { describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type TestProperty,
} from '#/shared/testing/server-function-harness'
import { PORTAL_SEED_CLEANUP_TABLES } from '#/shared/testing/server-function-portal-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  addStaffMember,
  changeStaffInvitationEmail,
  checkStaffBatch,
  checkStaffSource,
  listStaffMembers,
  removeStaffMember,
  renameStaffMember,
  resendStaffInvitation,
  setColleagueListEnabled,
} from './staff-accounts'

const harness = setupServerFunctionHarness({
  cleanupTables: PORTAL_SEED_CLEANUP_TABLES,
})

const UNKNOWN_ID = '33333333-3333-4333-8333-333333333333'

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const outsider = await harness.seedMember(organization, 'PropertyManager')
  const member = await harness.seedMember(organization, 'Member')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  const staff = await harness.seedMember(organization, 'Member')
  const participation = await harness.seedStaffParticipation(staff, property, {
    linkUser: false,
  })
  return { organization, admin, manager, outsider, member, property, participation }
}

type Scope = Awaited<ReturnType<typeof hotel>>
type Call = (scope: Scope) => Promise<unknown>

const FUNCTIONS: readonly (readonly [string, Call])[] = [
  [
    'checkStaffSource',
    ({ property }) => checkStaffSource({ data: { propertyId: property.id } }),
  ],
  [
    'checkStaffBatch',
    ({ property }) =>
      checkStaffBatch({
        data: {
          propertyId: property.id,
          rows: [{ email: 'new.person@example.test', displayName: 'New Person' }],
        },
      }),
  ],
  [
    'addStaffMember',
    ({ property }) =>
      addStaffMember({
        data: {
          propertyId: property.id,
          email: 'new.person@example.test',
          displayName: 'New Person',
          operationId: UNKNOWN_ID,
        },
      }),
  ],
  [
    'resendStaffInvitation',
    ({ participation }) =>
      resendStaffInvitation({ data: { participationId: participation.participationId } }),
  ],
  [
    'changeStaffInvitationEmail',
    ({ participation }) =>
      changeStaffInvitationEmail({
        data: {
          participationId: participation.participationId,
          email: 'changed@example.test',
        },
      }),
  ],
  [
    'removeStaffMember',
    ({ participation }) =>
      removeStaffMember({ data: { participationId: participation.participationId } }),
  ],
  [
    'renameStaffMember',
    ({ participation }) =>
      renameStaffMember({
        data: { participationId: participation.participationId, displayName: 'Renamed' },
      }),
  ],
  [
    'listStaffMembers',
    ({ property }) => listStaffMembers({ data: { propertyId: property.id } }),
  ],
  [
    'setColleagueListEnabled',
    ({ property }) =>
      setColleagueListEnabled({ data: { propertyId: property.id, enabled: true } }),
  ],
]

async function participationState(id: string) {
  const { rows } = await harness
    .pool()
    .query(`SELECT display_name, status FROM staff_participations WHERE id = $1`, [id])
  return rows[0]
}

async function participationCount(property: TestProperty) {
  const { rows } = await harness
    .pool()
    .query(`SELECT count(*)::int AS n FROM staff_participations WHERE property_id = $1`, [
      property.id,
    ])
  return rows[0].n as number
}

async function colleagueListEnabled(property: TestProperty) {
  const { rows } = await harness
    .pool()
    .query(
      `SELECT colleague_list_enabled FROM staff_property_settings WHERE property_id = $1`,
      [property.id],
    )
  return rows[0]?.colleague_list_enabled as boolean | undefined
}

const MANAGER_ONLY_BY_ADMIN = 'setColleagueListEnabled'

describe.each(FUNCTIONS)('%s', (name, call) => {
  it('refuses a caller with no session', async () => {
    const scope = await hotel()

    await expect(harness.callAs(null, () => call(scope))).rejects.toMatchObject({
      status: 401,
    })
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const scope = await hotel()

    await expect(harness.callAs(scope.outsider, () => call(scope))).rejects.toMatchObject(
      {
        code: name === MANAGER_ONLY_BY_ADMIN ? 'permission_denied' : 'scope_denied',
        status: 403,
      },
    )
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const scope = await hotel()

    await expect(harness.callAs(scope.member, () => call(scope))).rejects.toMatchObject({
      code: 'beta_role_inactive',
    })
  })
})

describe('a refused call changes nothing', () => {
  it('leaves the staff member and the colleague list as they were', async () => {
    const scope = await hotel()
    const calls = FUNCTIONS.filter(([name]) =>
      ['renameStaffMember', 'removeStaffMember', 'setColleagueListEnabled'].includes(
        name,
      ),
    )

    for (const [, call] of calls) {
      await expect(harness.callAs(scope.member, () => call(scope))).rejects.toMatchObject(
        {
          status: 403,
        },
      )
    }

    expect(await participationState(scope.participation.participationId)).toEqual({
      display_name: 'Polly Smith',
      status: 'active',
    })
    expect(await colleagueListEnabled(scope.property)).toBeUndefined()
  })
})

describe('another Organization', () => {
  async function otherAdmin() {
    const elsewhere = await harness.seedOrganization()
    return harness.seedMember(elsewhere, 'AccountAdmin')
  }

  it.each([
    'resendStaffInvitation',
    'changeStaffInvitationEmail',
    'removeStaffMember',
    'renameStaffMember',
  ])('does not find the staff member for %s', async (name) => {
    const scope = await hotel()
    const call = FUNCTIONS.find(([candidate]) => candidate === name)![1]

    await expect(
      harness.callAs(await otherAdmin(), () => call(scope)),
    ).rejects.toMatchObject({ code: 'participation_not_found', status: 404 })
    expect(await participationState(scope.participation.participationId)).toEqual({
      display_name: 'Polly Smith',
      status: 'active',
    })
  })

  it.each(['checkStaffSource', 'addStaffMember'])(
    'does not find the Property for %s',
    async (name) => {
      const scope = await hotel()
      const call = FUNCTIONS.find(([candidate]) => candidate === name)![1]

      await expect(
        harness.callAs(await otherAdmin(), () => call(scope)),
      ).rejects.toMatchObject({ code: 'property_not_found', status: 409 })
      expect(await participationCount(scope.property)).toBe(1)
    },
  )

  it('answers a batch check for its Property as not found', async () => {
    const scope = await hotel()
    const call = FUNCTIONS.find(([name]) => name === 'checkStaffBatch')![1]

    const answer = await harness.callAs(await otherAdmin(), () => call(scope))

    expect(answer).toMatchObject({ code: 'property_not_found' })
  })

  it('lists no staff of the Property', async () => {
    const scope = await hotel()

    const listed = await harness.callAs(await otherAdmin(), () =>
      listStaffMembers({ data: { propertyId: scope.property.id } }),
    )

    expect(listed.members).toEqual([])
  })

  it('refuses to change the colleague list and writes nothing', async () => {
    const scope = await hotel()

    const response = await harness.respondAs(await otherAdmin(), () =>
      setColleagueListEnabled({ data: { propertyId: scope.property.id, enabled: true } }),
    )

    expect(response.ok).toBe(false)
    expect(await colleagueListEnabled(scope.property)).toBeUndefined()
  })
})

describe('an AccountAdmin', () => {
  it('lists the staff of the Property', async () => {
    const { admin, property, participation } = await hotel()

    const listed = await harness.callAs(admin, () =>
      listStaffMembers({ data: { propertyId: property.id } }),
    )

    expect(listed.members.map((member) => member.participationId)).toEqual([
      participation.participationId,
    ])
  })

  it('renames a staff member', async () => {
    const { admin, participation } = await hotel()

    const answer = await harness.callAs(admin, () =>
      renameStaffMember({
        data: { participationId: participation.participationId, displayName: 'Renamed' },
      }),
    )

    expect(answer).toEqual({ renamed: true })
    expect(await participationState(participation.participationId)).toMatchObject({
      display_name: 'Renamed',
    })
  })

  it('removes a staff member', async () => {
    const { admin, participation } = await hotel()

    const answer = await harness.callAs(admin, () =>
      removeStaffMember({ data: { participationId: participation.participationId } }),
    )

    expect(answer).toEqual({ removed: true })
    expect(await participationState(participation.participationId)).toMatchObject({
      status: 'archived',
    })
  })

  it('turns the colleague list on for the Property', async () => {
    const { admin, property } = await hotel()

    const answer = await harness.callAs(admin, () =>
      setColleagueListEnabled({ data: { propertyId: property.id, enabled: true } }),
    )

    expect(answer).toEqual({ enabled: true })
    expect(await colleagueListEnabled(property)).toBe(true)
  })
})

describe('a PropertyManager the Property was granted to', () => {
  it('lists, renames and removes staff', async () => {
    const { manager, property, participation } = await hotel()

    const listed = await harness.callAs(manager, () =>
      listStaffMembers({ data: { propertyId: property.id } }),
    )
    const renamed = await harness.callAs(manager, () =>
      renameStaffMember({
        data: { participationId: participation.participationId, displayName: 'Renamed' },
      }),
    )
    const removed = await harness.callAs(manager, () =>
      removeStaffMember({ data: { participationId: participation.participationId } }),
    )

    expect(listed.members).toHaveLength(1)
    expect(renamed).toEqual({ renamed: true })
    expect(removed).toEqual({ removed: true })
  })

  it('may not change the colleague list', async () => {
    const { manager, property } = await hotel()

    await expect(
      harness.callAs(manager, () =>
        setColleagueListEnabled({ data: { propertyId: property.id, enabled: true } }),
      ),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })
    expect(await colleagueListEnabled(property)).toBeUndefined()
  })
})

describe('adding staff before Portal address recovery is configured', () => {
  it.each(['checkStaffSource', 'addStaffMember'])(
    'answers %s with its actionable code and adds nobody',
    async (name) => {
      const scope = await hotel()
      const call = FUNCTIONS.find(([candidate]) => candidate === name)![1]

      await expect(harness.callAs(scope.admin, () => call(scope))).rejects.toMatchObject({
        code: 'address_keyring_missing',
        status: 409,
      })
      expect(await participationCount(scope.property)).toBe(1)
    },
  )

  it('flags the batch check with the same code', async () => {
    const scope = await hotel()
    const call = FUNCTIONS.find(([name]) => name === 'checkStaffBatch')![1]

    const answer = await harness.callAs(scope.admin, () => call(scope))

    expect(answer).toMatchObject({ code: 'address_keyring_missing' })
  })
})

describe('invitations', () => {
  it('refuses a resend for a staff member whose invitation has ended', async () => {
    const { admin, participation } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        resendStaffInvitation({
          data: { participationId: participation.participationId },
        }),
      ),
    ).rejects.toMatchObject({ code: 'participation_not_found', status: 404 })
  })

  it('refuses to change the email of an invitation that was not issued', async () => {
    const { admin, participation } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        changeStaffInvitationEmail({
          data: {
            participationId: participation.participationId,
            email: 'changed@example.test',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'operation_conflict', status: 409 })
  })
})
