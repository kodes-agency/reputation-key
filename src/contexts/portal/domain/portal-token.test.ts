import { describe, it, expect } from 'vitest'
import { issueToken, rotateToken } from './portal-token'

describe('PortalToken', () => {
  const NOW = new Date('2026-01-15T12:00:00Z')

  const baseParams = {
    id: 'token-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    portalId: 'portal-1',
    tokenIdentifier: 'identifier-one',
    tokenHash: 'hash-abc',
    tokenKeyVersion: 1,
    version: 1,
    now: NOW,
  }

  const replacement = {
    id: 'token-2',
    tokenIdentifier: 'identifier-new',
    tokenHash: 'hash-new',
    tokenKeyVersion: 1,
    version: 2,
  }

  describe('issueToken', () => {
    it('creates an active token', () => {
      const t = issueToken(baseParams)
      expect(t.status).toBe('active')
      expect(t.revokedAt).toBeNull()
    })
  })

  describe('rotateToken', () => {
    it('creates old (rotating) and new (active) tokens', () => {
      const result = rotateToken(issueToken(baseParams), replacement, 60000, NOW)
      expect(result.oldToken.status).toBe('rotating')
      expect(result.oldToken.gracePeriodEnds).toEqual(new Date(NOW.getTime() + 60000))
      expect(result.newToken.status).toBe('active')
      expect(result.newToken.tokenHash).toBe('hash-new')
      expect(result.newToken.version).toBe(2)
    })

    it('refuses a token that is not active', () => {
      const revoked = { ...issueToken(baseParams), status: 'revoked' as const }
      expect(() => rotateToken(revoked, replacement, 60000, NOW)).toThrow(/revoked/)
    })
  })
})
