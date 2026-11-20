// Google Performance server functions, called as signed-in members over
// PostgreSQL with the real tenant resolution. The harness has no Google
// provider runtime, so the functions answer as an Organization without one.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import {
  getPropertyGooglePerformance,
  renewPropertyGooglePerformanceLease,
} from './google-performance'

const harness = setupServerFunctionHarness()

const NO_STORE = {
  'cache-control': 'private, no-store, max-age=0',
  pragma: 'no-cache',
  expires: '0',
}

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const property = await harness.seedProperty(organization)
  return { organization, admin, property }
}

describe('getPropertyGooglePerformance', () => {
  it('answers unavailable and forbids caching when no Google runtime is configured', async () => {
    const { admin, property } = await hotel()

    const response = await harness.respondAs(admin, () =>
      getPropertyGooglePerformance({ data: { propertyId: property.id, preset: '30d' } }),
    )

    expect(response.ok && response.value).toEqual({
      status: 'unavailable',
      reason: 'integration_unavailable',
      action: null,
    })
    expect(Object.fromEntries(response.headers)).toMatchObject(NO_STORE)
  })

  it('refuses a caller with no session', async () => {
    const { property } = await hotel()

    await expect(
      harness.callAs(null, () =>
        getPropertyGooglePerformance({
          data: { propertyId: property.id, preset: '30d' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it.each([
    [
      'a Property id that is not a UUID',
      { propertyId: 'property-1', preset: '30d' },
      /propertyId/,
    ],
    [
      'a preset outside the offered ranges',
      { propertyId: 'ignored', preset: '14d' },
      /preset/,
    ],
    [
      'an extra key',
      { propertyId: 'ignored', preset: '30d', actor: 'someone' },
      /actor|unrecognized/i,
    ],
  ])('refuses %s', async (_name, data, message) => {
    const { admin, property } = await hotel()
    const input = {
      ...data,
      propertyId: data.propertyId === 'ignored' ? property.id : data.propertyId,
    }

    await expect(
      harness.callAs(admin, () => getPropertyGooglePerformance({ data: input as never })),
    ).rejects.toThrow(message)
  })
})

describe('renewPropertyGooglePerformanceLease', () => {
  it('contains the failure: an unknown lease is not renewed', async () => {
    const { admin, property } = await hotel()

    const response = await harness.respondAs(admin, () =>
      renewPropertyGooglePerformanceLease({
        data: { propertyId: property.id, leaseRef: 'lease-ref' },
      }),
    )

    expect(response.ok && response.value).toEqual({ ok: false })
    expect(Object.fromEntries(response.headers)).toMatchObject(NO_STORE)
  })

  it('refuses a caller with no session', async () => {
    const { property } = await hotel()

    await expect(
      harness.callAs(null, () =>
        renewPropertyGooglePerformanceLease({
          data: { propertyId: property.id, leaseRef: 'lease-ref' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })
})
