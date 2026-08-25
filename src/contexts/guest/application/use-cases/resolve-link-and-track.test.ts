import { describe, expect, it, vi } from 'vitest'
import { resolveLinkAndTrack } from './resolve-link-and-track'
import { portalLinkId } from '#/shared/domain/ids'

const LINK_ID = portalLinkId('link-0000-0000-4000-8000-000000000001')
const TOKEN = 'opaque-public-token'

const portal = {
  portal: {
    id: 'portal-p1',
    name: 'P1 Portal',
    slug: 'p1',
    description: null,
    heroImageUrl: null,
    theme: null,
    organizationName: 'Org A',
  },
  categories: [],
  links: [
    {
      id: LINK_ID,
      label: 'Review',
      url: 'https://example.com',
      categoryId: null,
      sortKey: 'a',
    },
  ],
  reviewGateway: {
    privateFeedbackThreshold: 3,
    googleReviewUri: 'https://search.google.com/local/writereview?placeid=property-p1',
  },
  organizationId: 'org-a',
  propertyId: 'property-p1',
} as const

describe('resolveLinkAndTrack (token-bound public redirect)', () => {
  it('resolves a link owned by the policy-authorized token Portal without tracking a GET', async () => {
    const tracked: unknown[] = []
    const useCase = resolveLinkAndTrack({
      publicPortalLookup: { findByToken: async () => portal },
      trackClick: async (input) => {
        tracked.push(input)
      },
    })

    await expect(useCase({ token: TOKEN, linkId: LINK_ID })).resolves.toEqual({
      url: 'https://example.com',
    })
    expect(tracked).toEqual([])
  })

  it('tracks only an explicitly qualified signed-session mutation', async () => {
    const tracked: unknown[] = []
    const useCase = resolveLinkAndTrack({
      publicPortalLookup: { findByToken: async () => portal },
      trackClick: async (input) => {
        tracked.push(input)
      },
    })
    const sessionExpiresAt = new Date('2026-05-02T12:00:00Z')

    await expect(
      useCase({
        token: TOKEN,
        linkId: LINK_ID,
        qualifyObservation: async () => ({
          sessionId: '00000000-0000-4000-8000-000000000100',
          sessionExpiresAt,
        }),
      }),
    ).resolves.toEqual({ url: 'https://example.com' })
    expect(tracked).toEqual([
      {
        linkId: LINK_ID,
        destinationKind: 'secondary_link',
        sessionId: '00000000-0000-4000-8000-000000000100',
        sessionExpiresAt,
        organizationId: 'org-a',
        propertyId: 'property-p1',
        portalId: 'portal-p1',
      },
    ])
  })

  it('returns the same inert denial for an unavailable token without tracking', async () => {
    let effects = 0
    const useCase = resolveLinkAndTrack({
      publicPortalLookup: { findByToken: async () => null },
      trackClick: async () => {
        effects += 1
      },
    })

    await expect(useCase({ token: 'wrong-token', linkId: LINK_ID })).resolves.toBeNull()
    expect(effects).toBe(0)
  })

  it('rejects a P1 link forged under a P2 token without resolving or tracking it', async () => {
    let effects = 0
    const useCase = resolveLinkAndTrack({
      publicPortalLookup: {
        findByToken: async () => ({
          ...portal,
          portal: { ...portal.portal, id: 'portal-p2' },
          propertyId: 'property-p2',
          links: [],
        }),
      },
      trackClick: async () => {
        effects += 1
      },
    })

    await expect(useCase({ token: 'p2-token', linkId: LINK_ID })).resolves.toBeNull()
    expect(effects).toBe(0)
  })

  it('returns the stored destination but suppresses an unqualified metric', async () => {
    let effects = 0
    const qualifyObservation = vi.fn(async () => null)
    const useCase = resolveLinkAndTrack({
      publicPortalLookup: { findByToken: async () => portal },
      trackClick: async () => {
        effects += 1
      },
    })

    await expect(
      useCase({ token: TOKEN, linkId: LINK_ID, qualifyObservation }),
    ).resolves.toEqual({ url: 'https://example.com' })
    expect(qualifyObservation).toHaveBeenCalledWith({
      linkId: LINK_ID,
      organizationId: 'org-a',
      propertyId: 'property-p1',
      portalId: 'portal-p1',
    })
    expect(effects).toBe(0)
  })

  it('keeps navigation available when the metric qualifier is unavailable', async () => {
    let effects = 0
    const reportObservationFailure = vi.fn()
    const failure = new Error('rate limit store unavailable')
    const useCase = resolveLinkAndTrack({
      publicPortalLookup: { findByToken: async () => portal },
      trackClick: async () => {
        effects += 1
      },
      reportObservationFailure,
    })

    await expect(
      useCase({
        token: TOKEN,
        linkId: LINK_ID,
        qualifyObservation: async () => Promise.reject(failure),
      }),
    ).resolves.toEqual({ url: 'https://example.com' })
    expect(reportObservationFailure).toHaveBeenCalledWith(failure)
    expect(effects).toBe(0)
  })

  it('keeps navigation available when qualified observation persistence fails', async () => {
    const reportObservationFailure = vi.fn()
    const failure = new Error('observation transaction unavailable')
    const useCase = resolveLinkAndTrack({
      publicPortalLookup: { findByToken: async () => portal },
      trackClick: async () => Promise.reject(failure),
      reportObservationFailure,
    })

    await expect(
      useCase({
        token: TOKEN,
        linkId: LINK_ID,
        qualifyObservation: async () => ({
          sessionId: '00000000-0000-4000-8000-000000000100',
          sessionExpiresAt: new Date('2026-05-02T12:00:00Z'),
        }),
      }),
    ).resolves.toEqual({ url: 'https://example.com' })
    expect(reportObservationFailure).toHaveBeenCalledWith(failure)
  })
})
