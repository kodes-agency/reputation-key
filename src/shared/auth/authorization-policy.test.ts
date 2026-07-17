// Tests for AuthorizationPolicy (B0.6).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  checkAuthorization,
  authorize,
  AuthorizationError,
  capabilityForPermission,
  requireAuthorized,
} from './authorization-policy'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  type CapabilityPolicyStore,
} from './beta-capabilities'
import { buildTestAuthContext } from '#/shared/testing/fixtures'

function makeStore(
  overrides: Partial<CapabilityPolicyStore> = {},
): CapabilityPolicyStore {
  return {
    isCapabilityGloballyEnabled: () => true,
    isOrgAllowlisted: () => true,
    isPropertyAllowlisted: () => true,
    isOrgSuspended: () => false,
    isPropertySuspended: () => false,
    ...overrides,
  }
}

describe('AuthorizationPolicy', () => {
  beforeEach(() => {
    initCapabilityPolicyStore(makeStore())
  })

  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  describe('checkAuthorization', () => {
    it('allows when all layers pass', () => {
      const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
      const decision = checkAuthorization({
        actor: ctx,
        action: 'property.create',
        capability: 'property.create',
      })
      expect(decision.allowed).toBe(true)
      expect(decision.reason).toBe('allowed')
    })

    it('denies when capability is disabled', () => {
      initCapabilityPolicyStore(makeStore({ isCapabilityGloballyEnabled: () => false }))
      const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
      const decision = checkAuthorization({
        actor: ctx,
        action: 'property.create',
        capability: 'property.create',
      })
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('capability_denied')
    })

    it('denies when permission is not granted by role', () => {
      const ctx = buildTestAuthContext({ role: 'Staff' })
      const decision = checkAuthorization({
        actor: ctx,
        action: 'property.create',
        capability: 'property.create',
      })
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('permission_denied')
    })

    it('denies when property scope does not include the property', () => {
      const ctx = buildTestAuthContext({ role: 'PropertyManager' })
      const decision = checkAuthorization({
        actor: ctx,
        action: 'inbox.read',
        capability: 'inbox.use',
        propertyId: 'prop-other',
        assignedPropertyIds: new Set(['prop-mine']),
      })
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('scope_denied')
    })

    it('allows when property is in assigned scope', () => {
      const ctx = buildTestAuthContext({ role: 'PropertyManager' })
      const decision = checkAuthorization({
        actor: ctx,
        action: 'inbox.read',
        capability: 'inbox.use',
        propertyId: 'prop-mine',
        assignedPropertyIds: new Set(['prop-mine']),
      })
      expect(decision.allowed).toBe(true)
    })

    it('allows any property for AccountAdmin (all scope)', () => {
      const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
      const decision = checkAuthorization({
        actor: ctx,
        action: 'inbox.read',
        capability: 'inbox.use',
        propertyId: 'prop-any',
      })
      expect(decision.allowed).toBe(true)
    })
  })

  describe('capabilityForPermission (BQR-4.1)', () => {
    it('maps enabled surfaces to core capabilities', () => {
      expect(capabilityForPermission('inbox.read')).toBe('inbox.use')
      expect(capabilityForPermission('review.read')).toBe('review.use')
      expect(capabilityForPermission('dashboard.read')).toBe('dashboard.use')
      expect(capabilityForPermission('property.create')).toBe('property.create')
      expect(capabilityForPermission('reply.manage')).toBe('property.publish_reply')
    })

    it('maps dark surfaces to non-core capabilities', () => {
      expect(capabilityForPermission('goal.read')).toBe('goal.use')
      expect(capabilityForPermission('portal.read')).toBe('portal.read')
      expect(capabilityForPermission('team.create')).toBe('team.use')
    })

    it('maps portal mutations to portal.write (BQC-0.2 / STD-P0-01)', () => {
      expect(capabilityForPermission('portal.create')).toBe('portal.write')
      expect(capabilityForPermission('portal.update')).toBe('portal.write')
      expect(capabilityForPermission('portal.delete')).toBe('portal.write')
    })
  })

  describe('requireAuthorized (BQR-4.1)', () => {
    it('does not throw for allowed AccountAdmin property.create', () => {
      const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
      expect(() =>
        requireAuthorized({ actor: ctx, action: 'property.create' }),
      ).not.toThrow()
    })

    it('throws AuthError path for denied Staff property.create', () => {
      const ctx = buildTestAuthContext({ role: 'Staff' })
      expect(() => requireAuthorized({ actor: ctx, action: 'property.create' })).toThrow()
    })
  })

  describe('authorize (throwing variant)', () => {
    it('throws AuthorizationError when denied', () => {
      const ctx = buildTestAuthContext({ role: 'Staff' })
      expect(() =>
        authorize({
          actor: ctx,
          action: 'property.create',
          capability: 'property.create',
        }),
      ).toThrow(AuthorizationError)
    })

    it('does not throw when allowed', () => {
      const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
      expect(() =>
        authorize({
          actor: ctx,
          action: 'property.create',
          capability: 'property.create',
        }),
      ).not.toThrow()
    })
  })

  describe('cross-tenant isolation', () => {
    it('denies access when property belongs to a different org context', () => {
      // PropertyManagers can only access assigned properties.
      // A PM in org A should not access a property from org B.
      // The repository layer enforces org-scoping; this test verifies
      // the authorization layer also catches it via scope checking.
      const ctx = buildTestAuthContext({
        role: 'PropertyManager',
        organizationId: 'org-a' as never,
      })
      const decision = checkAuthorization({
        actor: ctx,
        action: 'inbox.read',
        capability: 'inbox.use',
        propertyId: 'prop-from-org-b',
        assignedPropertyIds: new Set(['prop-from-org-a']),
      })
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('scope_denied')
    })
  })
})
