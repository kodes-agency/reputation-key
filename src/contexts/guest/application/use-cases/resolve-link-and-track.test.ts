// Guest context — resolveLinkAndTrack use case tests
import { describe, it, expect } from 'vitest'
import { resolveLinkAndTrack } from './resolve-link-and-track'
import {
  portalLinkId,
  type OrganizationId,
  type PropertyId,
  type PortalId,
} from '#/shared/domain/ids'

const LINK_ID = portalLinkId('link-0000-0000-4000-8000-000000000001')

describe('resolveLinkAndTrack (use case)', () => {
  it('resolves link and tracks click', async () => {
    let trackCalled = false
    const useCase = resolveLinkAndTrack({
      linkResolver: {
        resolveLinkById: async () => ({
          id: 'resolved-link-id',
          url: 'https://example.com',
          organizationId: 'org-1' as OrganizationId,
          propertyId: 'prop-1' as PropertyId,
          portalId: 'portal-1' as PortalId,
        }),
      },
      trackClick: async () => {
        trackCalled = true
      },
    })

    const result = await useCase({ linkId: LINK_ID })

    expect(result).not.toBeNull()
    expect(result!.url).toBe('https://example.com')
    expect(trackCalled).toBe(true)
  })

  it('returns null when link not found', async () => {
    let trackCalled = false
    const useCase = resolveLinkAndTrack({
      linkResolver: {
        resolveLinkById: async () => null,
      },
      trackClick: async () => {
        trackCalled = true
      },
    })

    const result = await useCase({ linkId: LINK_ID })

    expect(result).toBeNull()
    expect(trackCalled).toBe(false)
  })
})
