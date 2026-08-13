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
  organizationId: 'org-1',
  propertyId: 'property-1',
} as const

function setup(
  overrides: {
    digest?: ResolvePublicPortalTokenDeps['tokenCodec']['digest']
    findToken?: ResolvePublicPortalTokenDeps['portalTokenRepo']['findResolvableByDigest']
    findPortal?: ResolvePublicPortalTokenDeps['portalRepo']['findPublicPortalById']
    decide?: ResolvePublicPortalTokenDeps['decidePublic']
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
      decidePublic: decide,
      clock: () => NOW,
    }),
    digest,
    findToken,
    findPortal,
    decide,
  }
}

describe('resolvePublicPortalToken', () => {
  it('loads a published portal through an active scoped token', async () => {
    const { resolve, findPortal, decide } = setup()

    await expect(resolve('pt_key_secret')).resolves.toEqual({
      status: 'found',
      data: publicPortal,
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
})
