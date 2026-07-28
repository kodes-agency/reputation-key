// Portal context — public-portal-outcome mapping tests (BQC-5.6).
// Pins the repository throw/null contract → outcome union mapping:
// portalError('portal_inactive') → inactive, null → not_found, data → found,
// and every other error (portal or foreign) rethrown unchanged.

import { describe, it, expect } from 'vitest'
import { toPublicPortalBySlugOutcome } from './public-portal-outcome'
import { portalError, isPortalError } from '../domain/errors'
import type { PublicPortalBySlugResult } from './public-api'

const sampleResult: PublicPortalBySlugResult = {
  portal: {
    id: 'portal-1',
    name: 'Front Desk',
    slug: 'front-desk',
    description: null,
    heroImageUrl: null,
    theme: null,
    smartRoutingEnabled: false,
    smartRoutingThreshold: 4,
    organizationName: 'Acme',
  },
  categories: [],
  links: [],
  organizationId: 'org-1',
  propertyId: 'prop-1',
}

describe('toPublicPortalBySlugOutcome', () => {
  it('maps resolved data to a found outcome', async () => {
    const outcome = await toPublicPortalBySlugOutcome(async () => sampleResult)

    expect(outcome).toEqual({ status: 'found', result: sampleResult })
  })

  it('maps a repository null to a not_found outcome', async () => {
    const outcome = await toPublicPortalBySlugOutcome(async () => null)

    expect(outcome).toEqual({ status: 'not_found' })
  })

  it("maps portalError('portal_inactive') to an inactive outcome", async () => {
    const outcome = await toPublicPortalBySlugOutcome(async () => {
      throw portalError('portal_inactive', 'Portal is inactive')
    })

    expect(outcome).toEqual({ status: 'inactive' })
  })

  it('re-throws a non-inactive PortalError unchanged', async () => {
    await expect(
      toPublicPortalBySlugOutcome(async () => {
        throw portalError('portal_not_found', 'missing')
      }),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'portal_not_found')
  })

  it('re-throws a foreign error unchanged', async () => {
    await expect(
      toPublicPortalBySlugOutcome(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })
})
