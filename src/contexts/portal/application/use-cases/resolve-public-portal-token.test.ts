import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalId } from '#/shared/domain/ids'
import type { PortalToken } from '../../domain/portal-token'
import {
  resolvePublicPortalToken,
  type ResolvePublicPortalTokenDeps,
} from './resolve-public-portal-token'

const NOW = new Date('2026-08-08T12:00:00.000Z')
const ORG = organizationId('org-1')
const PORTAL = portalId('portal-1')
const GOOGLE_REVIEW_URI = 'https://search.google.com/local/writereview?placeid=property-1'

const token: PortalToken = {
  id: 'token-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  portalId: 'portal-1',
  tokenIdentifier: 'token-key',
  tokenHash: 'digest',
  tokenKeyVersion: 1,
  version: 1,
  printBatch: null,
  status: 'active',
  issuedAt: NOW,
  gracePeriodEnds: null,
  retiredAt: null,
  revokedAt: null,
  revokedBy: null,
  revokedReason: null,
}

const publicPortal = {
  portal: {
    id: 'portal-1',
    name: 'Guest Portal',
    slug: 'guest',
    description: null,
    heroImageUrl: null,
    theme: null,
    organizationName: 'Example Org',
  },
  categories: [],
  links: [],
  privateFeedbackThreshold: 3,
  organizationId: 'org-1',
  propertyId: 'property-1',
} as const

function setup(
  overrides: {
    digest?: ResolvePublicPortalTokenDeps['tokenCodec']['digest']
    findToken?: ResolvePublicPortalTokenDeps['portalTokenRepo']['findResolvableByDigest']
    findPortal?: ResolvePublicPortalTokenDeps['portalRepo']['findPublicPortalById']
    getDestination?: ResolvePublicPortalTokenDeps['getGoogleReviewDestination']
    decide?: ResolvePublicPortalTokenDeps['decidePublic']
    reportDestinationFailure?: ResolvePublicPortalTokenDeps['reportGoogleDestinationFailure']
  } = {},
) {
  const digest = vi.fn(
    overrides.digest ??
      (() => ({
        tokenIdentifier: 'token-key',
        tokenHash: 'digest',
        tokenKeyVersion: 1,
      })),
  )
  const findToken = vi.fn(overrides.findToken ?? (async () => token))
  const findPortal = vi.fn(overrides.findPortal ?? (async () => publicPortal))
  const getDestination = vi.fn(
    overrides.getDestination ??
      (async () => ({
        state: 'verified' as const,
        uri: GOOGLE_REVIEW_URI,
        retrievedAt: NOW,
        sourceEpoch: 1,
        profileVersion: 2,
      })),
  )
  const decide = vi.fn(
    overrides.decide ??
      (async () => ({
        allowed: true,
        reason: 'allowed' as const,
        action: 'portal.public_read',
        policyVersion: 'test',
      })),
  )
  return {
    resolve: resolvePublicPortalToken({
      tokenCodec: { digest },
      portalTokenRepo: { findResolvableByDigest: findToken },
      portalRepo: { findPublicPortalById: findPortal },
      getGoogleReviewDestination: getDestination,
      decidePublic: decide,
      reportGoogleDestinationFailure: overrides.reportDestinationFailure,
      clock: () => NOW,
    }),
    digest,
    findToken,
    findPortal,
    getDestination,
    decide,
  }
}

describe('resolvePublicPortalToken', () => {
  it('loads a published portal through an active scoped token', async () => {
    const { resolve, findPortal, decide } = setup()

    await expect(resolve('pt_key_secret')).resolves.toEqual({
      status: 'found',
      data: {
        portal: publicPortal.portal,
        categories: [],
        links: [],
        reviewGateway: {
          privateFeedbackThreshold: 3,
          googleReview: { status: 'available', uri: GOOGLE_REVIEW_URI },
        },
        responseConfiguration: {
          publicationState: 'published',
          configurationDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
          guestLocale: 'en',
          languagePackVersion: 'guest-ui-en-v1',
          privateFeedbackThreshold: 3,
        },
        organizationId: 'org-1',
        propertyId: 'property-1',
      },
    })
    expect(findPortal).toHaveBeenCalledWith(ORG, PORTAL)
    expect(decide).toHaveBeenCalledWith({
      action: 'portal.public_read',
      capability: 'portal.public_read',
      organizationId: 'org-1',
      propertyId: 'property-1',
      now: NOW,
    })
  })

  it('returns one unavailable outcome for malformed, unknown, or denied tokens', async () => {
    const malformed = setup({ digest: vi.fn(() => null) })
    await expect(malformed.resolve('bad')).resolves.toEqual({ status: 'unavailable' })
    expect(malformed.findToken).not.toHaveBeenCalled()

    const unknown = setup({ findToken: vi.fn(async () => null) })
    await expect(unknown.resolve('pt_key_unknown')).resolves.toEqual({
      status: 'unavailable',
    })

    const denied = setup({
      decide: vi.fn(async () => ({
        allowed: false,
        reason: 'property_not_allowlisted' as const,
        action: 'portal.public_read',
        policyVersion: 'test',
      })),
    })
    await expect(denied.resolve('pt_key_denied')).resolves.toEqual({
      status: 'unavailable',
    })
    expect(denied.findPortal).not.toHaveBeenCalled()
  })

  it('fails closed when token and portal tenant/property scopes disagree', async () => {
    const mismatch = setup({
      findPortal: vi.fn(async () => ({ ...publicPortal, propertyId: 'property-2' })),
    })

    await expect(mismatch.resolve('pt_key_secret')).resolves.toEqual({
      status: 'unavailable',
    })
  })

  it.each(['awaiting_refresh', 'unavailable'] as const)(
    'keeps the private gateway available without a stale URI when the Property destination is %s',
    async (state) => {
      const harness = setup({
        getDestination: vi.fn(async () => ({
          state,
          uri: state === 'awaiting_refresh' ? GOOGLE_REVIEW_URI : null,
          retrievedAt: state === 'awaiting_refresh' ? NOW : null,
          sourceEpoch: state === 'awaiting_refresh' ? 1 : null,
          profileVersion: state === 'awaiting_refresh' ? 2 : null,
        })),
      })

      const outcome = await harness.resolve('pt_key_secret')
      expect(outcome).toMatchObject({
        status: 'found',
        data: {
          reviewGateway: {
            privateFeedbackThreshold: 3,
            googleReview: { status: 'unavailable' },
          },
        },
      })
      expect(JSON.stringify(outcome)).not.toContain(GOOGLE_REVIEW_URI)
    },
  )

  it('degrades and reports when the Property destination lookup is unavailable', async () => {
    const reportDestinationFailure = vi.fn()
    const failure = new Error('database unavailable')
    const harness = setup({
      getDestination: vi.fn(async () => {
        throw failure
      }),
      reportDestinationFailure,
    })

    await expect(harness.resolve('pt_key_secret')).resolves.toMatchObject({
      status: 'found',
      data: {
        reviewGateway: { googleReview: { status: 'unavailable' } },
      },
    })
    expect(reportDestinationFailure).toHaveBeenCalledWith(failure)
  })

  it('content-addresses the exact rendered configuration', async () => {
    const available = await setup().resolve('pt_key_secret')
    const unavailable = await setup({
      getDestination: vi.fn(async () => ({
        state: 'unavailable' as const,
        uri: null,
        retrievedAt: null,
        sourceEpoch: null,
        profileVersion: null,
      })),
    }).resolve('pt_key_secret')

    expect(available.status).toBe('found')
    expect(unavailable.status).toBe('found')
    if (available.status !== 'found' || unavailable.status !== 'found') return
    expect(available.data.responseConfiguration.configurationDigest).not.toBe(
      unavailable.data.responseConfiguration.configurationDigest,
    )
  })
})
