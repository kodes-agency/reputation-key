// Operational Action History server functions, called as signed-in members over
// PostgreSQL with the real tenant resolution, execution policy and Feed access
// use cases: only a current AccountAdmin reads or exports, and every read leaves
// its own access record.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  exportOperationalActionHistoryFn,
  listOperationalActionHistoryFn,
} from './activity'

const harness = setupServerFunctionHarness()

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  return { organization, admin }
}

async function recordsOf(organizationId: string) {
  const { rows } = await harness.pool().query<{
    action: string
    outcome: string
    actor_id: string
    sequence: number
  }>(
    `SELECT action, outcome, actor_id, sequence::int AS sequence
       FROM operational_action_history_records
      WHERE organization_id = $1 ORDER BY sequence`,
    [organizationId],
  )
  return rows
}

describe('listOperationalActionHistoryFn', () => {
  it('lists to an AccountAdmin and appends an access record that the next read lists', async () => {
    const { organization, admin } = await hotel()

    await harness.callAs(admin, () => listOperationalActionHistoryFn({ data: {} }))
    expect(await recordsOf(organization.id)).toMatchObject([
      {
        action: 'operational_history.accessed',
        outcome: 'succeeded',
        actor_id: admin.userId,
      },
    ])

    const second = await harness.callAs(admin, () =>
      listOperationalActionHistoryFn({ data: {} }),
    )
    expect(second.items).toMatchObject([
      { action: 'operational_history.accessed', outcome: 'succeeded' },
    ])
    expect(await recordsOf(organization.id)).toHaveLength(2)
  })

  it('refuses a PropertyManager and records nothing', async () => {
    const { organization } = await hotel()
    const manager = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(manager, () => listOperationalActionHistoryFn({ data: {} })),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })
    expect(await recordsOf(organization.id)).toEqual([])
  })

  it('refuses a member whose role has no beta access', async () => {
    const { organization } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () => listOperationalActionHistoryFn({ data: {} })),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () => listOperationalActionHistoryFn({ data: {} })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('shows another Organization’s AccountAdmin none of this Organization’s records', async () => {
    const { organization, admin } = await hotel()
    await harness.callAs(admin, () => listOperationalActionHistoryFn({ data: {} }))
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'AccountAdmin')

    const listed = await harness.callAs(stranger, () =>
      listOperationalActionHistoryFn({ data: {} }),
    )

    expect(listed.items).toEqual([])
    expect(await recordsOf(organization.id)).toHaveLength(1)
  })

  it('refuses an unknown action and a limit above 100 before reading', async () => {
    const { organization, admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        listOperationalActionHistoryFn({ data: { action: 'gossip' as never } }),
      ),
    ).rejects.toThrow(/action/i)
    await expect(
      harness.callAs(admin, () =>
        listOperationalActionHistoryFn({ data: { limit: 101 } }),
      ),
    ).rejects.toThrow(/limit/)
    expect(await recordsOf(organization.id)).toEqual([])
  })
})

describe('exportOperationalActionHistoryFn', () => {
  it('exports to an AccountAdmin and appends an exported record', async () => {
    const { organization, admin } = await hotel()

    const exported = await harness.callAs(admin, () =>
      exportOperationalActionHistoryFn({ data: {} }),
    )

    expect(exported).toMatchObject({
      formatVersion: 1,
      scope: { organizationId: organization.id },
      fingerprintSha256: expect.any(String),
    })
    expect(await recordsOf(organization.id)).toMatchObject([
      { action: 'operational_history.exported', outcome: 'succeeded' },
    ])
  })

  it('refuses a PropertyManager and records nothing', async () => {
    const { organization } = await hotel()
    const manager = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(manager, () => exportOperationalActionHistoryFn({ data: {} })),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })
    expect(await recordsOf(organization.id)).toEqual([])
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () => exportOperationalActionHistoryFn({ data: {} })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('accepts a limit of 500 and refuses 501', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        exportOperationalActionHistoryFn({ data: { limit: 500 } }),
      ),
    ).resolves.toMatchObject({ scope: { limit: 500 } })
    await expect(
      harness.callAs(admin, () =>
        exportOperationalActionHistoryFn({ data: { limit: 501 } }),
      ),
    ).rejects.toThrow(/limit/)
  })
})
