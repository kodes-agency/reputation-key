import { describe, it, expect } from 'vitest'
import {
  type PortalToken,
  issueToken,
  rotateToken,
  revokeToken,
  isActive,
  isInGracePeriod,
} from './portal-token'

describe('PortalToken', () => {
  const baseParams = {
    id: 'token-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    portalId: 'portal-1',
    tokenHash: 'hash-abc',
    version: 1,
  }

  describe('issueToken', () => {
    it('creates an active token', () => {
      const t = issueToken(baseParams)
      expect(t.status).toBe('active')
      expect(isActive(t)).toBe(true)
      expect(t.revokedAt).toBeNull()
    })
  })

  describe('rotateToken', () => {
    it('creates old (rotating) and new (active) tokens', () => {
      const t = issueToken(baseParams)
      const result = rotateToken(t, 'hash-new', 'token-2', 2, 60000)
      if ('oldToken' in result) {
        expect(result.oldToken.status).toBe('rotating')
        expect(result.oldToken.gracePeriodEnds).not.toBeNull()
        expect(result.newToken.status).toBe('active')
        expect(result.newToken.tokenHash).toBe('hash-new')
        expect(result.newToken.version).toBe(2)
      }
    })

    it('both tokens are active during grace period', () => {
      const t = issueToken(baseParams)
      const result = rotateToken(t, 'hash-new', 'token-2', 2, 60000)
      if ('oldToken' in result) {
        expect(isActive(result.oldToken)).toBe(true)
        expect(isActive(result.newToken)).toBe(true)
      }
    })

    it('prevents rotating a revoked token', () => {
      const t = revokeToken(issueToken(baseParams), 'admin', 'compromised') as PortalToken
      const result = rotateToken(t, 'hash-new', 'token-2', 2, 60000)
      expect(result).toHaveProperty('code', 'already_revoked')
    })
  })

  describe('revokeToken', () => {
    it('revokes an active token', () => {
      const t = issueToken(baseParams)
      const result = revokeToken(t, 'admin', 'compromised')
      expect(result).toHaveProperty('status', 'revoked')
      if (!('code' in result)) {
        expect(result.revokedBy).toBe('admin')
        expect(result.revokedReason).toBe('compromised')
      }
    })

    it('prevents revoking an already-revoked token', () => {
      const t = revokeToken(issueToken(baseParams), 'admin', 'test') as PortalToken
      const result = revokeToken(t, 'admin', 'again')
      expect(result).toHaveProperty('code', 'already_revoked')
    })

    it('revokes a rotating token', () => {
      const t = issueToken(baseParams)
      const rot = rotateToken(t, 'hash-new', 'token-2', 2, 60000)
      if ('oldToken' in rot) {
        const result = revokeToken(rot.oldToken, 'admin', 'urgent')
        expect(result).toHaveProperty('status', 'revoked')
      }
    })
  })

  describe('isActive', () => {
    it('active token is active', () => {
      expect(isActive(issueToken(baseParams))).toBe(true)
    })

    it('revoked token is not active', () => {
      const t = revokeToken(issueToken(baseParams), 'admin', 'test') as PortalToken
      expect(isActive(t)).toBe(false)
    })

    it('rotating token within grace period is active', () => {
      const t = issueToken(baseParams)
      const rot = rotateToken(t, 'hash-new', 'token-2', 2, 60000)
      if ('oldToken' in rot) {
        expect(isActive(rot.oldToken)).toBe(true)
      }
    })

    it('rotating token after grace period is not active', () => {
      const t = issueToken(baseParams)
      // Grace period of 0ms — immediately expired
      const rot = rotateToken(t, 'hash-new', 'token-2', 2, 0)
      if ('oldToken' in rot) {
        // Add 1ms to ensure we're past the grace end
        expect(isActive(rot.oldToken, new Date(Date.now() + 1000))).toBe(false)
      }
    })
  })

  describe('isInGracePeriod', () => {
    it('returns true for rotating token within grace', () => {
      const t = issueToken(baseParams)
      const rot = rotateToken(t, 'hash-new', 'token-2', 2, 60000)
      if ('oldToken' in rot) {
        expect(isInGracePeriod(rot.oldToken)).toBe(true)
      }
    })

    it('returns false for active token (not rotating)', () => {
      expect(isInGracePeriod(issueToken(baseParams))).toBe(false)
    })
  })
})
