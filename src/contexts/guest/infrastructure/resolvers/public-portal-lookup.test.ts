// Guest context — public-portal-lookup resolver tests
// Verifies the PortalError → GuestError translation, in particular that an
// inactive portal surfaces as guestError('portal_inactive') (→ 410) rather
// than falling through as an untagged 500.

import { describe, it, expect } from 'vitest'
import { createPublicPortalLookup } from './public-portal-lookup'
import { portalError, isPortalError } from '#/contexts/portal/domain/errors'
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

describe('createPublicPortalLookup — findBySlug error translation', () => {
  it('maps a portal_inactive PortalError to guestError(portal_inactive)', async () => {
    const api = createPortalApiStub(async () => {
      throw portalError('portal_inactive', 'Portal archived')
    })
    const lookup = createPublicPortalLookup(api)

    await expect(lookup.findBySlug('prop', 'portal')).rejects.toSatisfy(
      (e: unknown) => isGuestError(e) && e.code === 'portal_inactive',
    )
  })

  it('re-throws a non-inactive PortalError untouched (not mapped to guestError)', async () => {
    const api = createPortalApiStub(async () => {
      throw portalError('portal_not_found', 'missing')
    })
    const lookup = createPublicPortalLookup(api)

    await expect(lookup.findBySlug('prop', 'portal')).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'portal_not_found',
    )
  })

  it('re-throws a non-portal error untouched', async () => {
    const api = createPortalApiStub(async () => {
      throw new Error('boom')
    })
    const lookup = createPublicPortalLookup(api)

    await expect(lookup.findBySlug('prop', 'portal')).rejects.toThrow('boom')
  })

  it('returns the resolved portal data on success', async () => {
    const result = { portal: { id: 'p1' }, organizationId: 'org-1' }
    const api = createPortalApiStub(async () => result as never)
    const lookup = createPublicPortalLookup(api)

    await expect(lookup.findBySlug('prop', 'portal')).resolves.toBe(result)
  })
})
