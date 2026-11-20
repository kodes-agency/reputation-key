// The three server functions that hand a Portal's address back (issue,
// replace, "Download again"), called as signed-in members over PostgreSQL and
// the test Redis. Every answer, refusals included, is marked uncacheable, and
// the reveal spends its own rate limit only once the caller may see the Portal.

import { describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type CallResponse,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { issuePortalToken, revealPortalAddress, rotatePortalToken } from './portals'

const harness = setupServerFunctionHarness({
  env: { PORTAL_ADDRESS_ENCRYPTION_KEYS: `1:${'44'.repeat(32)}` },
  redis: true,
  cleanupTables: ['portal_access_artifacts', 'portal_tokens'],
})

const NO_STORE = 'private, no-store, max-age=0'

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const outsider = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPortal(property)
  return { organization, admin, outsider, portal }
}

function expectUncacheable(response: CallResponse<unknown>): void {
  expect(response.headers.get('cache-control')).toBe(NO_STORE)
  expect(response.headers.get('pragma')).toBe('no-cache')
}

type AddressCall = (input: { data: { portalId: string } }) => Promise<unknown>
const ADDRESS_HANDLERS: readonly (readonly [string, AddressCall])[] = [
  ['issuePortalToken', (input) => issuePortalToken(input)],
  ['rotatePortalToken', (input) => rotatePortalToken(input)],
]

describe.each(ADDRESS_HANDLERS)('%s', (name, handler) => {
  it('returns the addresses with the response marked uncacheable', async () => {
    const { admin, portal } = await hotel()
    if (name === 'rotatePortalToken') {
      await harness.callAs(admin, () =>
        issuePortalToken({ data: { portalId: portal.id } }),
      )
    }

    const response = await harness.respondAs(admin, () =>
      handler({ data: { portalId: portal.id } }),
    )

    expect(response).toMatchObject({
      ok: true,
      value: {
        publicUrls: {
          qr: expect.any(String),
          nfc: expect.any(String),
          direct: expect.any(String),
        },
      },
    })
    expectUncacheable(response)
  })

  it('marks a refusal uncacheable too, and changes nothing', async () => {
    const { outsider, portal } = await hotel()

    const response = await harness.respondAs(outsider, () =>
      handler({ data: { portalId: portal.id } }),
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'scope_denied', status: 403 },
    })
    expect(response.headers.get('cache-control')).toBe(NO_STORE)
    const { rows } = await harness
      .pool()
      .query(`SELECT 1 FROM portal_tokens WHERE portal_id = $1`, [portal.id])
    expect(rows).toEqual([])
  })
})

describe('revealPortalAddress', () => {
  const input = (portalId: string) => ({
    data: { portalId, purpose: 'download' as const },
  })

  it('returns the issued address with the response marked uncacheable', async () => {
    const { admin, portal } = await hotel()
    const issued = await harness.callAs(admin, () =>
      issuePortalToken({ data: { portalId: portal.id } }),
    )

    const response = await harness.respondAs(admin, () =>
      revealPortalAddress(input(portal.id)),
    )

    expect(response.ok).toBe(true)
    expect(response.ok && response.value).toMatchObject({
      publicUrl: issued.publicUrls.qr,
    })
    expectUncacheable(response)
  })

  it('spends the rate limit for this actor and Organization', async () => {
    const { admin, organization, portal } = await hotel()
    const redis = harness.redis()
    if (!redis) return
    await harness.callAs(admin, () => issuePortalToken({ data: { portalId: portal.id } }))

    await harness.callAs(admin, () => revealPortalAddress(input(portal.id)))

    const prefix = 'ratelimit:public:portal:address-reveal'
    expect(await redis.get(`${prefix}:actor:${organization.id}:${admin.userId}`)).toBe(
      '1',
    )
    expect(await redis.get(`${prefix}:organization:${organization.id}`)).toBe('1')
  })

  it('refuses with 429 once the actor used its 30 downloads, still uncacheable', async () => {
    const { admin, organization, portal } = await hotel()
    const redis = harness.redis()
    if (!redis) return
    await harness.callAs(admin, () => issuePortalToken({ data: { portalId: portal.id } }))
    await redis.set(
      `ratelimit:public:portal:address-reveal:actor:${organization.id}:${admin.userId}`,
      '30',
      'EX',
      3600,
    )

    const response = await harness.respondAs(admin, () =>
      revealPortalAddress(input(portal.id)),
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'rate_limited', status: 429 },
    })
    expect(response.headers.get('cache-control')).toBe(NO_STORE)
  })

  it('does not spend the rate limit or reveal when the Portal scope is denied', async () => {
    const { admin, outsider, organization, portal } = await hotel()
    const redis = harness.redis()
    await harness.callAs(admin, () => issuePortalToken({ data: { portalId: portal.id } }))

    const response = await harness.respondAs(outsider, () =>
      revealPortalAddress(input(portal.id)),
    )

    expect(response).toMatchObject({
      ok: false,
      error: { name: 'AuthError', code: 'scope_denied', status: 403 },
    })
    expect(response.headers.get('cache-control')).toBe(NO_STORE)
    if (redis) {
      expect(
        await redis.exists(
          `ratelimit:public:portal:address-reveal:organization:${organization.id}`,
        ),
      ).toBe(0)
    }
  })

  it('answers an address it cannot give back as a 422 the page can explain', async () => {
    const { admin, portal } = await hotel()

    await expect(
      harness.callAs(admin, () => revealPortalAddress(input(portal.id))),
    ).rejects.toMatchObject({ code: 'address_unavailable', status: 422 })
  })
})
