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
  isCapabilityJobEnabled,
  checkGlobalCapability,
  type CapabilityPolicyStore,
} from './beta-capabilities'
import { buildTestAuthContext } from '#/shared/testing/fixtures'

function makeStore(
  overrides: Partial<CapabilityPolicyStore> = {},
): CapabilityPolicyStore {
  return {
    isCapabilityGloballyEnabled: (cap) => {
      if (cap === 'identity.invite' || cap === 'property.create') return true
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
      const decision = checkBetaCapability(ctx, 'gbp.reply.auto_publish')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('capability_blocked')
    })

    it('allows AI capabilities when org is allowlisted (Google conditionally permits)', () => {
      const ctx = buildTestAuthContext()
      initCapabilityPolicyStore(
        makeStore({
          isCapabilityGloballyEnabled: () => false,
          isOrgAllowlisted: (orgId, cap) =>
            orgId === ctx.organizationId && cap === 'ai.analyze',
        }),
      )
      const decision = checkBetaCapability(ctx, 'ai.analyze')
      expect(decision.allowed).toBe(true)
      expect(decision.reason).toBe('allowed')
    })

    it('denies gbp.review_solicitation_gamification regardless of allowlist', () => {
      const ctx = buildTestAuthContext()
      initCapabilityPolicyStore(
        makeStore({
          isCapabilityGloballyEnabled: () => true,
          isOrgAllowlisted: () => true,
        }),
      )
      const decision = checkBetaCapability(ctx, 'gbp.review_solicitation_gamification')
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
      expect(store.isCapabilityGloballyEnabled('property.create')).toBe(true)
    })

    it('treats portal.read as non-core (BQR-0 dark portal/guest)', () => {
      const store = createEnvCapabilityPolicyStore({})
      expect(store.isCapabilityGloballyEnabled('portal.read')).toBe(false)
      expect(isCoreCapability('portal.read')).toBe(false)
    })

    it('does not allowlist non-core capabilities without BETA_ALLOWLIST_ORGS', () => {
      const store = createEnvCapabilityPolicyStore({})
      expect(store.isOrgAllowlisted('org-1', 'goal.use')).toBe(false)
    })

    it('enables listed non-core capabilities via BETA_E2E_GLOBAL_CAPABILITIES', () => {
      const store = createEnvCapabilityPolicyStore({
        BETA_E2E_GLOBAL_CAPABILITIES: 'identity.register,organization.create,team.use',
      })
      expect(store.isCapabilityGloballyEnabled('identity.register')).toBe(true)
      expect(store.isCapabilityGloballyEnabled('organization.create')).toBe(true)
      expect(store.isCapabilityGloballyEnabled('team.use')).toBe(true)
      // Unlisted non-core stay off
      expect(store.isCapabilityGloballyEnabled('goal.use')).toBe(false)
    })

    it('never enables blocked capabilities via BETA_E2E_GLOBAL_CAPABILITIES', () => {
      const store = createEnvCapabilityPolicyStore({
        BETA_E2E_GLOBAL_CAPABILITIES: 'notification.send_email,gbp.reply.auto_publish',
      })
      expect(store.isCapabilityGloballyEnabled('notification.send_email')).toBe(false)
      expect(store.isCapabilityGloballyEnabled('gbp.reply.auto_publish')).toBe(false)
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
      expect(store.isOrgAllowlisted('org-1', 'gbp.reply.auto_publish')).toBe(false)
      expect(store.isOrgAllowlisted('org-1', 'gbp.ai.cross_property_summary')).toBe(false)
    })

    it('allowlists AI capabilities for listed orgs (Google conditionally permits)', () => {
      const store = createEnvCapabilityPolicyStore({
        BETA_ALLOWLIST_ORGS: 'org-1',
      })
      expect(store.isOrgAllowlisted('org-1', 'ai.analyze')).toBe(true)
      expect(store.isOrgAllowlisted('org-1', 'ai.generate_reply')).toBe(true)
    })

    it('detects suspended orgs', () => {
      const store = createEnvCapabilityPolicyStore({
        BETA_SUSPENDED_ORGS: 'org-bad',
      })
      expect(store.isOrgSuspended('org-bad')).toBe(true)
    })
  })

  describe('capability metadata', () => {
    it('identifies core capabilities', () => {
      expect(isCoreCapability('identity.invite')).toBe(true)
      expect(isCoreCapability('goal.use')).toBe(false)
      expect(isCoreCapability('portal.read')).toBe(false)
    })

    it('identifies blocked capabilities', () => {
      expect(isBlockedCapability('gbp.reply.auto_publish')).toBe(true)
      expect(isBlockedCapability('gbp.review_solicitation_gamification')).toBe(true)
      expect(isBlockedCapability('ai.analyze')).toBe(false)
      expect(isBlockedCapability('identity.invite')).toBe(false)
    })
  })

  describe('isCapabilityJobEnabled / checkGlobalCapability', () => {
    it('allows core capability jobs', () => {
      // Default store treats identity.invite as globally enabled in makeStore
      expect(isCapabilityJobEnabled('identity.invite')).toBe(true)
    })

    it('denies dark-context jobs by default', () => {
      expect(isCapabilityJobEnabled('goal.use')).toBe(false)
      expect(isCapabilityJobEnabled('badge.use')).toBe(false)
      expect(isCapabilityJobEnabled('leaderboard.use')).toBe(false)
      expect(isCapabilityJobEnabled('team.use')).toBe(false)
      expect(isCapabilityJobEnabled('portal.read')).toBe(false)
    })

    it('denies blocked capability jobs', () => {
      expect(isCapabilityJobEnabled('notification.send_email')).toBe(false)
      expect(checkGlobalCapability('notification.send_email').allowed).toBe(false)
    })
  })
})
