// Tests for AuthorizationPolicy (B0.6).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { checkAuthorization, authorize, AuthorizationError } from './authorization-policy'
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
        capability: 'portal.read',
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
        capability: 'portal.read',
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
        capability: 'portal.read',
        propertyId: 'prop-any',
      })
      expect(decision.allowed).toBe(true)
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
        capability: 'portal.read',
        propertyId: 'prop-from-org-b',
        assignedPropertyIds: new Set(['prop-from-org-a']),
      })
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('scope_denied')
    })
  })
})
