// The print kit read, called as signed-in members over PostgreSQL with the real
// tenant resolution, execution policy and Portal scope. It reads the live
// version and discloses no address, so it neither spends the disclosure limit
// nor marks the response.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { PORTAL_SEED_CLEANUP_TABLES } from '#/shared/testing/server-function-portal-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { getPortalPrintKit } from './portal-print-kit'

const harness = setupServerFunctionHarness({
  redis: true,
  cleanupTables: PORTAL_SEED_CLEANUP_TABLES,
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPublishedPortal(property)
  return { organization, admin, property, portal }
}

/** The keys the call left in this file's own Redis namespace. */
async function rateLimitKeys(): Promise<string[]> {
  const redis = harness.redis()
  if (!redis) return []
  return redis.keys(`${redis.options.keyPrefix ?? ''}*`)
}

describe('getPortalPrintKit', () => {
  it('reads the print kit of the Portal as the caller', async () => {
    const { admin, portal } = await hotel()

    const kit = await harness.callAs(admin, () =>
      getPortalPrintKit({ data: { portalId: portal.id } }),
    )

    expect(kit).toMatchObject({
      portalId: portal.id,
      lastPrint: null,
      primaryLocale: 'en',
      locales: ['en', 'bg'],
    })
    expect(JSON.stringify(kit)).not.toContain(portal.rawToken ?? 'no address')
  })

  it('discloses nothing, so it neither limits the rate nor marks the response', async () => {
    const { admin, portal } = await hotel()

    const response = await harness.respondAs(admin, () =>
      getPortalPrintKit({ data: { portalId: portal.id } }),
    )

    expect(response.ok).toBe(true)
    expect([...response.headers.keys()]).toEqual([])
    expect(await rateLimitKeys()).toEqual([])
    // The namespace is the one the container's limiter writes to.
    if (!harness.redis()) return
    await harness.container().rateLimiter.check(`control:${portal.id}`)
    expect(await rateLimitKeys()).toHaveLength(1)
  })

  it('answers a Portal that does not exist as a 404', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        getPortalPrintKit({ data: { portalId: '00000000-0000-4000-8000-0000000000aa' } }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })
  })

  it('does not find another Organization’s Portal', async () => {
    const { portal } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(stranger, () =>
        getPortalPrintKit({ data: { portalId: portal.id } }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })
  })

  it('refuses a PropertyManager without a grant on the Portal’s Property', async () => {
    const { organization, portal } = await hotel()
    const manager = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(manager, () => getPortalPrintKit({ data: { portalId: portal.id } })),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('asks for a publication before a draft Portal can be printed', async () => {
    const { admin, property } = await hotel()
    const draft = await harness.seedPortal(property, { name: 'Draft' })

    await expect(
      harness.callAs(admin, () => getPortalPrintKit({ data: { portalId: draft.id } })),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable', status: 409 })
  })
})
