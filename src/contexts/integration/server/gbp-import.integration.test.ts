// Google Business Profile import server functions, called as signed-in members
// over PostgreSQL with the real tenant resolution and execution policy. The
// harness has no Google provider runtime, so discovery answers as unavailable.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { listImportAccounts, startPropertyImportV2 } from './gbp-import'

const harness = setupServerFunctionHarness({
  cleanupTables: ['google_import_items', 'google_imports'],
})

const REQUEST_ID = '00000000-0000-4000-8000-000000000001'
const CONNECTION_ID = '00000000-0000-4000-8000-000000000004'

const startInput = (candidateRef = 'A'.repeat(43), requestId = REQUEST_ID) => ({
  requestId,
  confirmation: 'apply' as const,
  items: [
    {
      candidateRef,
      action: 'create' as const,
      profile: {
        name: 'Cafe North',
        address: null,
        countryCode: 'US',
        timezone: 'America/New_York',
        confirmed: true as const,
      },
    },
  ],
})

async function importRows(organizationId: string): Promise<number> {
  const { rows } = await harness
    .pool()
    .query('SELECT count(*)::int AS n FROM google_imports WHERE organization_id = $1', [
      organizationId,
    ])
  return rows[0].n
}

describe('startPropertyImportV2', () => {
  it('refuses a candidate no discovery issued, with a 404, and writes nothing', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')

    const response = await harness.respondAs(admin, () =>
      startPropertyImportV2({ data: startInput() }),
    )

    expect(!response.ok && response.error).toMatchObject({
      name: 'GoogleImportTransactionError',
      code: 'invalid_reference',
      status: 404,
    })
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'cache-control': 'private, no-store, max-age=0',
      pragma: 'no-cache',
      expires: '0',
    })
    expect(await importRows(organization.id)).toBe(0)
  })

  it('refuses a PropertyManager and writes nothing', async () => {
    const organization = await harness.seedOrganization()
    const manager = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(manager, () => startPropertyImportV2({ data: startInput() })),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })
    expect(await importRows(organization.id)).toBe(0)
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const organization = await harness.seedOrganization()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () => startPropertyImportV2({ data: startInput() })),
    ).rejects.toMatchObject({ code: 'beta_role_inactive', status: 403 })
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () => startPropertyImportV2({ data: startInput() })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it.each([
    ['a request id that is not a UUID', startInput(undefined, 'request-1'), /requestId/],
    ['a candidate reference of the wrong length', startInput('short'), /candidateRef/],
  ])('refuses %s before reading anything', async (_name, data, message) => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')

    await expect(
      harness.callAs(admin, () => startPropertyImportV2({ data })),
    ).rejects.toThrow(message)
    expect(await importRows(organization.id)).toBe(0)
  })
})

describe('listImportAccounts', () => {
  it('answers 503 while no Google runtime is configured', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')

    await expect(
      harness.callAs(admin, () =>
        listImportAccounts({ data: { connectionId: CONNECTION_ID } }),
      ),
    ).rejects.toMatchObject({
      name: 'GoogleImportDiscoveryError',
      code: 'temporarily_unavailable',
      status: 503,
    })
  })

  it('refuses a PropertyManager', async () => {
    const organization = await harness.seedOrganization()
    const manager = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(manager, () =>
        listImportAccounts({ data: { connectionId: CONNECTION_ID } }),
      ),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })
  })
})
