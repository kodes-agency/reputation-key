// Property archive, restore and Google disconnect server functions, called as
// signed-in members over PostgreSQL with the real tenant resolution and
// execution policy.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import {
  archiveProperty,
  disconnectPropertyGoogleBinding,
  restoreProperty,
} from './property-lifecycle'
import {
  listPropertyResponsibleManagers,
  updatePropertyResponsibleManagers,
} from './property-responsible-managers'
import {
  expectBrowserProperty,
  seedGoogleBoundProperty,
} from './property-server.test-fixtures'

// A Google connection cannot go while a Property still names it, so the
// Properties are deleted ahead of their connections.
const harness = setupServerFunctionHarness({
  cleanupTables: ['property_responsible_managers', 'properties', 'google_connections'],
})

const REASON = 'Property no longer trading'

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const member = await harness.seedMember(organization, 'Member')
  return { organization, admin, manager, member }
}

async function lifecycleRow(propertyId: string) {
  const { rows } = await harness.pool().query(
    `SELECT lifecycle_state, purge_scheduled_for, google_binding_state
       FROM properties WHERE id = $1`,
    [propertyId],
  )
  return rows[0] as {
    lifecycle_state: string
    purge_scheduled_for: Date | null
    google_binding_state: string
  }
}

async function outboxTypes(organizationId: string) {
  const { rows } = await harness
    .pool()
    .query(`SELECT event_type FROM outbox_events WHERE organization_id = $1`, [
      organizationId,
    ])
  return rows.map((row: { event_type: string }) => row.event_type)
}

async function assignResponsibleManager(
  admin: Awaited<ReturnType<typeof hotel>>['admin'],
  manager: Awaited<ReturnType<typeof hotel>>['manager'],
  propertyId: string,
) {
  const listed = await harness.callAs(admin, () =>
    listPropertyResponsibleManagers({ data: { propertyId } }),
  )
  await harness.callAs(admin, () =>
    updatePropertyResponsibleManagers({
      data: {
        propertyId,
        managerUserIds: [manager.userId],
        expectedRevision: listed.revision,
      },
    }),
  )
}

describe('archiveProperty', () => {
  it('archives for an AccountAdmin and answers the Property in browser shape', async () => {
    const { organization, admin } = await hotel()
    const property = await harness.seedProperty(organization)

    const response = await harness.callAs(admin, () =>
      archiveProperty({ data: { propertyId: property.id, reason: REASON } }),
    )

    expect(response.property).toMatchObject({
      id: property.id,
      lifecycleState: 'archived',
    })
    const row = await lifecycleRow(property.id)
    expect(row.lifecycle_state).toBe('archived')
    expect(row.purge_scheduled_for).toBeInstanceOf(Date)
    expect(await outboxTypes(organization.id)).toContain('property.archived')
  })

  it('answers a Google-bound Property without its Google identity', async () => {
    const { organization, admin } = await hotel()
    const property = await seedGoogleBoundProperty(harness, organization)

    const response = await harness.callAs(admin, () =>
      archiveProperty({ data: { propertyId: property.id, reason: REASON } }),
    )

    expectBrowserProperty(response.property, property, { lifecycleState: 'archived' })
  })

  it('refuses a PropertyManager even with a current grant, and writes nothing', async () => {
    const { organization, manager } = await hotel()
    const property = await harness.seedProperty(organization)
    await harness.grantProperty(manager, property)

    await expect(
      harness.callAs(manager, () =>
        archiveProperty({ data: { propertyId: property.id, reason: REASON } }),
      ),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })

    expect((await lifecycleRow(property.id)).lifecycle_state).toBe('active')
    expect(await outboxTypes(organization.id)).toEqual([])
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, member } = await hotel()
    const property = await harness.seedProperty(organization)

    await expect(
      harness.callAs(member, () =>
        archiveProperty({ data: { propertyId: property.id, reason: REASON } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive', status: 403 })

    expect((await lifecycleRow(property.id)).lifecycle_state).toBe('active')
  })

  it('refuses a caller with no session', async () => {
    const { organization } = await hotel()
    const property = await harness.seedProperty(organization)

    await expect(
      harness.callAs(null, () =>
        archiveProperty({ data: { propertyId: property.id, reason: REASON } }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('does not find the Property for an AccountAdmin of another Organization', async () => {
    const { organization } = await hotel()
    const property = await harness.seedProperty(organization)
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        archiveProperty({ data: { propertyId: property.id, reason: REASON } }),
      ),
    ).rejects.toMatchObject({ code: 'property_not_found', status: 404 })

    expect((await lifecycleRow(property.id)).lifecycle_state).toBe('active')
  })

  it('refuses a missing Property id before reading anything', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        archiveProperty({ data: { propertyId: '', reason: REASON } }),
      ),
    ).rejects.toThrow(/propertyId/)
  })

  it('refuses a reason that is too short before reading anything', async () => {
    const { organization, admin } = await hotel()
    const property = await harness.seedProperty(organization)

    await expect(
      harness.callAs(admin, () =>
        archiveProperty({ data: { propertyId: property.id, reason: 'no' } }),
      ),
    ).rejects.toThrow(/reason/)
    expect((await lifecycleRow(property.id)).lifecycle_state).toBe('active')
  })
})

describe('restoreProperty', () => {
  async function archivedWithManager() {
    const setup = await hotel()
    const property = await harness.seedProperty(setup.organization)
    await harness.grantProperty(setup.manager, property)
    await assignResponsibleManager(setup.admin, setup.manager, property.id)
    await harness.callAs(setup.admin, () =>
      archiveProperty({ data: { propertyId: property.id, reason: REASON } }),
    )
    return { ...setup, property }
  }

  it('restores for an AccountAdmin and answers the Property in browser shape', async () => {
    const { organization, admin, property } = await archivedWithManager()

    const response = await harness.callAs(admin, () =>
      restoreProperty({ data: { propertyId: property.id } }),
    )

    expect(response.property).toMatchObject({ id: property.id, lifecycleState: 'active' })
    const row = await lifecycleRow(property.id)
    expect(row.lifecycle_state).toBe('active')
    expect(row.purge_scheduled_for).toBeNull()
    expect(await outboxTypes(organization.id)).toContain('property.restored')
  })

  it('answers a Google-bound Property without its Google identity and says it is ready', async () => {
    const { organization, admin, manager } = await hotel()
    const property = await seedGoogleBoundProperty(harness, organization)
    await harness.grantProperty(manager, property)
    await assignResponsibleManager(admin, manager, property.id)
    await harness.callAs(admin, () =>
      archiveProperty({ data: { propertyId: property.id, reason: REASON } }),
    )

    const response = await harness.callAs(admin, () =>
      restoreProperty({ data: { propertyId: property.id } }),
    )

    expect(response.googleBindingReadiness).toBe('ready')
    expectBrowserProperty(response.property, property, { lifecycleState: 'active' })
  })

  it('refuses a PropertyManager and leaves the Property archived', async () => {
    const { organization, manager, property } = await archivedWithManager()

    await expect(
      harness.callAs(manager, () =>
        restoreProperty({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })

    expect((await lifecycleRow(property.id)).lifecycle_state).toBe('archived')
    expect(await outboxTypes(organization.id)).not.toContain('property.restored')
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { member, property } = await archivedWithManager()

    await expect(
      harness.callAs(member, () =>
        restoreProperty({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('does not find the Property for an AccountAdmin of another Organization', async () => {
    const { property } = await archivedWithManager()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        restoreProperty({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'property_not_found', status: 404 })
    expect((await lifecycleRow(property.id)).lifecycle_state).toBe('archived')
  })

  it('refuses while no eligible Responsible Manager is assigned', async () => {
    const { organization, admin } = await hotel()
    const property = await harness.seedProperty(organization)
    await harness.callAs(admin, () =>
      archiveProperty({ data: { propertyId: property.id, reason: REASON } }),
    )

    await expect(
      harness.callAs(admin, () => restoreProperty({ data: { propertyId: property.id } })),
    ).rejects.toMatchObject({ code: 'property_restore_not_ready', status: 409 })

    expect((await lifecycleRow(property.id)).lifecycle_state).toBe('archived')
  })

  it('refuses after the recovery window has ended', async () => {
    const { admin, property } = await archivedWithManager()
    await harness
      .pool()
      .query(
        `UPDATE properties SET purge_scheduled_for = NOW() - INTERVAL '1 day' WHERE id = $1`,
        [property.id],
      )

    await expect(
      harness.callAs(admin, () => restoreProperty({ data: { propertyId: property.id } })),
    ).rejects.toMatchObject({ code: 'property_recovery_expired', status: 409 })

    expect((await lifecycleRow(property.id)).lifecycle_state).toBe('archived')
  })

  it('refuses a missing Property id before reading anything', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () => restoreProperty({ data: { propertyId: '' } })),
    ).rejects.toThrow(/propertyId/)
  })
})

describe('disconnectPropertyGoogleBinding', () => {
  it('disconnects an archived Property and keeps the Organization connection', async () => {
    const { organization, admin } = await hotel()
    const property = await seedGoogleBoundProperty(harness, organization, {
      lifecycleState: 'archived',
      purgeScheduledFor: new Date(Date.now() + 86_400_000),
    })

    const response = await harness.callAs(admin, () =>
      disconnectPropertyGoogleBinding({ data: { propertyId: property.id } }),
    )

    expect(response.binding).toMatchObject({
      state: 'disconnected',
      sourceEpoch: expect.any(Number),
    })
    expect((await lifecycleRow(property.id)).google_binding_state).toBe('disconnected')
    const { rowCount } = await harness
      .pool()
      .query(`SELECT 1 FROM google_connections WHERE id = $1`, [property.connectionId])
    expect(rowCount).toBe(1)
    expect(await outboxTypes(organization.id)).toContain(
      'property.google_binding.changed',
    )
  })

  it('refuses an active Property and leaves its binding alone', async () => {
    const { organization, admin } = await hotel()
    const property = await seedGoogleBoundProperty(harness, organization)

    await expect(
      harness.callAs(admin, () =>
        disconnectPropertyGoogleBinding({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition', status: 409 })

    expect((await lifecycleRow(property.id)).google_binding_state).toBe('active')
    expect(await outboxTypes(organization.id)).toEqual([])
  })

  it('refuses a PropertyManager and leaves the binding alone', async () => {
    const { organization, manager } = await hotel()
    const property = await seedGoogleBoundProperty(harness, organization, {
      lifecycleState: 'archived',
      purgeScheduledFor: new Date(Date.now() + 86_400_000),
    })
    await harness.grantProperty(manager, property)

    await expect(
      harness.callAs(manager, () =>
        disconnectPropertyGoogleBinding({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })

    expect((await lifecycleRow(property.id)).google_binding_state).toBe('active')
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, member } = await hotel()
    const property = await harness.seedProperty(organization)

    await expect(
      harness.callAs(member, () =>
        disconnectPropertyGoogleBinding({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('does not find the Property for an AccountAdmin of another Organization', async () => {
    const { organization } = await hotel()
    const property = await seedGoogleBoundProperty(harness, organization, {
      lifecycleState: 'archived',
      purgeScheduledFor: new Date(Date.now() + 86_400_000),
    })
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        disconnectPropertyGoogleBinding({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'property_not_found', status: 404 })
    expect((await lifecycleRow(property.id)).google_binding_state).toBe('active')
  })
})
