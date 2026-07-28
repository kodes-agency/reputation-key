import { describe, it, expect } from 'vitest'
import {
  type PropertyAccessGrant,
  createGrant,
  revokeGrant,
  allowsAction,
  isActive,
  isValidKind,
} from './property-access-grant'

describe('PropertyAccessGrant', () => {
  const NOW = new Date('2026-01-15T12:00:00Z')

  const baseParams = {
    id: 'grant-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    userId: 'user-1',
    kind: 'full_access' as const,
    grantedBy: 'admin-1',
    now: NOW,
  }

  describe('createGrant', () => {
    it('creates an active grant', () => {
      const result = createGrant(baseParams)
      expect(result).toHaveProperty('status', 'active')
      if (!('code' in result)) {
        expect(isActive(result)).toBe(true)
        expect(result.revokedAt).toBeNull()
      }
    })

    it('rejects invalid kind', () => {
      const result = createGrant({ ...baseParams, kind: 'super_admin' as never })
      expect(result).toHaveProperty('code', 'invalid_kind')
    })
  })

  describe('revokeGrant', () => {
    it('revokes an active grant', () => {
      const grant = createGrant(baseParams) as PropertyAccessGrant
      const result = revokeGrant(grant, 'admin-2', 'offboarding', 3, NOW)
      expect(result).toHaveProperty('status', 'revoked')
      if (!('code' in result)) {
        expect(result.revokedAt).toEqual(NOW)
        expect(result.revokedBy).toBe('admin-2')
        expect(result.reason).toBe('offboarding')
      }
    })

    it('prevents revoking the last full_access grant', () => {
      const grant = createGrant(baseParams) as PropertyAccessGrant
      const result = revokeGrant(grant, 'admin-2', 'test', 1, NOW)
      expect(result).toHaveProperty('code', 'last_owner_protection')
    })

    it('prevents revoking an already-revoked grant', () => {
      const grant = createGrant(baseParams) as PropertyAccessGrant
      const revoked = revokeGrant(grant, 'admin-2', 'test', 3, NOW) as PropertyAccessGrant
      const result = revokeGrant(revoked, 'admin-3', 'again', 3, NOW)
      expect(result).toHaveProperty('code', 'grant_not_active')
    })

    it('allows revoking non-full_access even when alone', () => {
      const grant = createGrant({ ...baseParams, kind: 'view' }) as PropertyAccessGrant
      const result = revokeGrant(grant, 'admin-2', 'test', 0, NOW)
      expect(result).toHaveProperty('status', 'revoked')
    })
  })

  describe('allowsAction', () => {
    it('full_access allows all actions', () => {
      const grant = createGrant(baseParams) as PropertyAccessGrant
      expect(allowsAction(grant, 'full_access')).toBe(true)
      expect(allowsAction(grant, 'manage')).toBe(true)
      expect(allowsAction(grant, 'respond')).toBe(true)
      expect(allowsAction(grant, 'view')).toBe(true)
    })

    it('view does not allow manage', () => {
      const grant = createGrant({ ...baseParams, kind: 'view' }) as PropertyAccessGrant
      expect(allowsAction(grant, 'view')).toBe(true)
      expect(allowsAction(grant, 'manage')).toBe(false)
      expect(allowsAction(grant, 'respond')).toBe(false)
    })

    it('revoked grant allows nothing', () => {
      const grant = createGrant(baseParams) as PropertyAccessGrant
      const revoked = revokeGrant(grant, 'admin', 'test', 3, NOW) as PropertyAccessGrant
      expect(allowsAction(revoked, 'view')).toBe(false)
    })
  })

  describe('isValidKind', () => {
    it('accepts valid kinds', () => {
      expect(isValidKind('full_access')).toBe(true)
      expect(isValidKind('manage')).toBe(true)
      expect(isValidKind('respond')).toBe(true)
      expect(isValidKind('view')).toBe(true)
    })

    it('rejects invalid kinds', () => {
      expect(isValidKind('admin')).toBe(false)
      expect(isValidKind('')).toBe(false)
    })
  })
})
