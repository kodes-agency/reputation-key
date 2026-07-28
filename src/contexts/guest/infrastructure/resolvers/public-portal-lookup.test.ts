// Guest context — public-portal-lookup resolver tests
// Verifies the portal outcome → guest translation, in particular that an
// inactive portal surfaces as guestError('portal_inactive') (→ 410) rather
// than falling through as an untagged 500.
//
// BQC-5.6: the portal public-api returns a typed PublicPortalBySlugOutcome
// union; this test builds outcomes directly and has no portal error imports —
// the portal inactive/not-found mapping is portal-owned (portal-side test).

import { describe, it, expect } from 'vitest'
import { createPublicPortalLookup } from './public-portal-lookup'
import { isGuestError } from '../../domain/errors'
import type { PortalPublicApi } from '#/contexts/portal/application/public-api'

function createPortalApiStub(
  findPublicPortalBySlug: PortalPublicApi['findPublicPortalBySlug'],
): PortalPublicApi {
  return {
    resolvePortalContext: async () => null,
    getPortalInfo: async () => null,
    findPublicPortalBySlug,
  }
}

describe('createPublicPortalLookup — findBySlug outcome translation', () => {
  it('maps an inactive outcome to guestError(portal_inactive)', async () => {
    const api = createPortalApiStub(async () => ({ status: 'inactive' }))
    const lookup = createPublicPortalLookup(api)

    await expect(lookup.findBySlug('prop', 'portal')).rejects.toSatisfy(
      (e: unknown) => isGuestError(e) && e.code === 'portal_inactive',
    )
  })

  it('maps a not_found outcome to null', async () => {
    const api = createPortalApiStub(async () => ({ status: 'not_found' }))
    const lookup = createPublicPortalLookup(api)

    await expect(lookup.findBySlug('prop', 'portal')).resolves.toBeNull()
  })

  it('returns the resolved portal data on a found outcome', async () => {
    const result = { portal: { id: 'p1' }, organizationId: 'org-1' }
    const api = createPortalApiStub(async () => ({ status: 'found', result }) as never)
    const lookup = createPublicPortalLookup(api)

    await expect(lookup.findBySlug('prop', 'portal')).resolves.toBe(result)
  })

  it('re-throws a foreign error untouched', async () => {
    const api = createPortalApiStub(async () => {
      throw new Error('boom')
    })
    const lookup = createPublicPortalLookup(api)

    await expect(lookup.findBySlug('prop', 'portal')).rejects.toThrow('boom')
  })
})
