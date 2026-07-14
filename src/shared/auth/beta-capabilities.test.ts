// Tests for BetaCapabilities module (B0.5).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  checkBetaCapability,
  assertBetaCapability,
  BetaCapabilityError,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  createEnvCapabilityPolicyStore,
  isCoreCapability,
  isBlockedCapability,
  type CapabilityPolicyStore,
} from './beta-capabilities'
import { buildTestAuthContext } from '#/shared/testing/fixtures'

function makeStore(
  overrides: Partial<CapabilityPolicyStore> = {},
): CapabilityPolicyStore {
  return {
    isCapabilityGloballyEnabled: (cap) => {
      if (cap === 'identity.invite' || cap === 'property.create' || cap === 'portal.read')
        return true
      return false
    },
    isOrgAllowlisted: (_orgId, _cap) => false,
    isPropertyAllowlisted: () => true,
    isOrgSuspended: () => false,
    isPropertySuspended: () => false,
    ...overrides,
  }
}

describe('BetaCapabilities', () => {
  beforeEach(() => {
    initCapabilityPolicyStore(makeStore())
  })

  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  describe('checkBetaCapability', () => {
    it('allows core capabilities for authenticated users', () => {
      const ctx = buildTestAuthContext()
      const decision = checkBetaCapability(ctx, 'identity.invite')
      expect(decision.allowed).toBe(true)
      expect(decision.reason).toBe('allowed')
    })

    it('denies non-core capabilities when org not allowlisted', () => {
      const ctx = buildTestAuthContext()
      const decision = checkBetaCapability(ctx, 'goal.use')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('org_not_allowlisted')
    })

    it('allows non-core capabilities when org is allowlisted', () => {
      const ctx = buildTestAuthContext()
      initCapabilityPolicyStore(
        makeStore({
          isCapabilityGloballyEnabled: () => false,
          isOrgAllowlisted: (orgId, cap) =>
            orgId === ctx.organizationId && cap === 'goal.use',
        }),
      )
      const decision = checkBetaCapability(ctx, 'goal.use')
      expect(decision.allowed).toBe(true)
    })

    it('denies blocked capabilities even when allowlisted', () => {
      const ctx = buildTestAuthContext()
      initCapabilityPolicyStore(
        makeStore({
          isCapabilityGloballyEnabled: () => true,
          isOrgAllowlisted: () => true,
        }),
      )
      const decision = checkBetaCapability(ctx, 'ai.analyze')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('capability_blocked')
    })

    it('denies all capabilities when org is suspended', () => {
      const ctx = buildTestAuthContext()
      initCapabilityPolicyStore(
        makeStore({ isOrgSuspended: (orgId) => orgId === ctx.organizationId }),
      )
      const decision = checkBetaCapability(ctx, 'identity.invite')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('org_suspended')
    })

    it('denies all capabilities when property is suspended', () => {
      const ctx = buildTestAuthContext()
      initCapabilityPolicyStore(makeStore({ isPropertySuspended: () => true }))
      const decision = checkBetaCapability(ctx, 'portal.read', 'prop-1')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('property_suspended')
    })

    it('denies core capabilities when globally disabled (kill switch)', () => {
      const ctx = buildTestAuthContext()
      initCapabilityPolicyStore(makeStore({ isCapabilityGloballyEnabled: () => false }))
      const decision = checkBetaCapability(ctx, 'identity.invite')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('capability_disabled')
    })
  })

  describe('assertBetaCapability', () => {
    it('throws BetaCapabilityError when denied', () => {
      const ctx = buildTestAuthContext()
      expect(() => assertBetaCapability(ctx, 'goal.use')).toThrow(BetaCapabilityError)
    })

    it('does not throw when allowed', () => {
      const ctx = buildTestAuthContext()
      expect(() => assertBetaCapability(ctx, 'identity.invite')).not.toThrow()
    })
  })

  describe('createEnvCapabilityPolicyStore', () => {
    it('disables all capabilities when BETA_CAPABILITIES_OFF=1', () => {
      const store = createEnvCapabilityPolicyStore({ BETA_CAPABILITIES_OFF: '1' })
      expect(store.isCapabilityGloballyEnabled('identity.invite')).toBe(false)
      expect(store.isCapabilityGloballyEnabled('property.create')).toBe(false)
    })

    it('allows core capabilities by default', () => {
      const store = createEnvCapabilityPolicyStore({})
      expect(store.isCapabilityGloballyEnabled('identity.invite')).toBe(true)
      expect(store.isCapabilityGloballyEnabled('portal.read')).toBe(true)
    })

    it('does not allowlist non-core capabilities without BETA_ALLOWLIST_ORGS', () => {
      const store = createEnvCapabilityPolicyStore({})
      expect(store.isOrgAllowlisted('org-1', 'goal.use')).toBe(false)
    })

    it('allowlists non-core capabilities for listed orgs', () => {
      const store = createEnvCapabilityPolicyStore({
        BETA_ALLOWLIST_ORGS: 'org-1,org-2',
      })
      expect(store.isOrgAllowlisted('org-1', 'goal.use')).toBe(true)
      expect(store.isOrgAllowlisted('org-3', 'goal.use')).toBe(false)
    })

    it('never allowlists blocked capabilities', () => {
      const store = createEnvCapabilityPolicyStore({
        BETA_ALLOWLIST_ORGS: 'org-1',
      })
      expect(store.isOrgAllowlisted('org-1', 'ai.analyze')).toBe(false)
    })

    it('detects suspended orgs', () => {
      const store = createEnvCapabilityPolicyStore({
        BETA_SUSPENDED_ORGS: 'org-bad',
      })
      expect(store.isOrgSuspended('org-bad')).toBe(true)
      expect(store.isOrgSuspended('org-good')).toBe(false)
    })
  })

  describe('capability metadata', () => {
    it('identifies core capabilities', () => {
      expect(isCoreCapability('identity.invite')).toBe(true)
      expect(isCoreCapability('goal.use')).toBe(false)
    })

    it('identifies blocked capabilities', () => {
      expect(isBlockedCapability('ai.analyze')).toBe(true)
      expect(isBlockedCapability('identity.invite')).toBe(false)
    })
  })
})
