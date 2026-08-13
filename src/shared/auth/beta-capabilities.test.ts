// Tests for BetaCapabilities module (B0.5).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  checkBetaCapability,
  checkScopedCapability,
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
    it('promotes Portal write, upload, guest, and email through scoped allowlists', () => {
      const ctx = buildTestAuthContext()
      initCapabilityPolicyStore(
        makeStore({
          isCapabilityGloballyEnabled: () => false,
          isOrgAllowlisted: (orgId) => orgId === ctx.organizationId,
          isPropertyAllowlisted: (candidatePropertyId) => candidatePropertyId === 'p1',
        }),
      )

      for (const capability of [
        'portal.write',
        'portal.upload',
        'portal.public_read',
        'portal.guest_response',
        'portal.guest_text',
        'portal.guest_contact',
        'portal.guest_media',
        'notification.send_email',
      ] as const) {
        expect(
          checkScopedCapability(
            { organizationId: ctx.organizationId, propertyId: 'p1' },
            capability,
          ),
        ).toEqual({
          allowed: true,
          reason: 'allowed',
          capability,
        })
        expect(
          checkScopedCapability(
            { organizationId: ctx.organizationId, propertyId: 'p2' },
            capability,
          ).reason,
        ).toBe('property_not_allowlisted')
      }
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

    it('treats BETA_CAPABILITIES_OFF=all as the global kill switch (BQC-0.4)', () => {
      const store = createEnvCapabilityPolicyStore({ BETA_CAPABILITIES_OFF: 'all' })
      expect(store.isCapabilityGloballyEnabled('identity.invite')).toBe(false)
      expect(store.isCapabilityGloballyEnabled('property.create')).toBe(false)
      expect(store.isCapabilityGloballyEnabled('review.use')).toBe(false)
    })

    it('disables exactly the listed capabilities when BETA_CAPABILITIES_OFF is a comma list (BQC-0.4)', () => {
      const store = createEnvCapabilityPolicyStore({
        BETA_CAPABILITIES_OFF: 'property.connect_gbp,property.publish_reply',
      })
      // Listed: off — this is the Google sync/import/publish stop control.
      expect(store.isCapabilityGloballyEnabled('property.connect_gbp')).toBe(false)
      expect(store.isCapabilityGloballyEnabled('property.publish_reply')).toBe(false)
      // Unlisted: untouched (core still on, non-core still default-off).
      expect(store.isCapabilityGloballyEnabled('property.create')).toBe(true)
      expect(store.isCapabilityGloballyEnabled('review.use')).toBe(true)
      expect(store.isCapabilityGloballyEnabled('goal.use')).toBe(false)
    })

    it('keeps a capability kill switch authoritative over an org allowlist', () => {
      initCapabilityPolicyStore(
        createEnvCapabilityPolicyStore({
          BETA_CAPABILITIES_OFF: 'goal.use',
          BETA_ALLOWLIST_ORGS: 'org-1',
        }),
      )

      expect(checkScopedCapability({ organizationId: 'org-1' }, 'goal.use')).toEqual({
        allowed: false,
        reason: 'capability_disabled',
        capability: 'goal.use',
      })
    })

    it('ignores unknown entries in the kill list', () => {
      const store = createEnvCapabilityPolicyStore({
        BETA_CAPABILITIES_OFF: 'not.a.cap, property.create ',
      })
      expect(store.isCapabilityGloballyEnabled('property.create')).toBe(false)
      expect(store.isCapabilityGloballyEnabled('review.use')).toBe(true)
    })

    it('keeps blocked capabilities blocked regardless of the kill list', () => {
      const store = createEnvCapabilityPolicyStore({
        BETA_CAPABILITIES_OFF: 'portal.write,review.use',
      })
      expect(store.isCapabilityGloballyEnabled('portal.write')).toBe(false)
      expect(store.isOrgAllowlisted('org-1', 'portal.write')).toBe(false)
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

    it('enables promotable email but never permanent prohibitions via E2E override', () => {
      const store = createEnvCapabilityPolicyStore({
        BETA_E2E_GLOBAL_CAPABILITIES: 'notification.send_email,gbp.reply.auto_publish',
      })
      expect(store.isCapabilityGloballyEnabled('notification.send_email')).toBe(true)
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

    it('identifies only permanent Google prohibitions as blocked', () => {
      expect(isBlockedCapability('gbp.reply.auto_publish')).toBe(true)
      expect(isBlockedCapability('gbp.ai.cross_property_summary')).toBe(true)
      expect(isBlockedCapability('gbp.review_solicitation_gamification')).toBe(true)
      expect(isBlockedCapability('portal.write')).toBe(false)
      expect(isBlockedCapability('portal.upload')).toBe(false)
      expect(isBlockedCapability('notification.send_email')).toBe(false)
    })
  })

  describe('isCapabilityJobEnabled / checkGlobalCapability', () => {
    it('allows core capability jobs', () => {
      // Default store treats identity.invite as globally enabled in makeStore
      expect(isCapabilityJobEnabled('identity.invite')).toBe(true)
    })

    it('registers every promotable capability job', () => {
      expect(isCapabilityJobEnabled('goal.use')).toBe(true)
      expect(isCapabilityJobEnabled('badge.use')).toBe(true)
      expect(isCapabilityJobEnabled('leaderboard.use')).toBe(true)
      expect(isCapabilityJobEnabled('team.use')).toBe(true)
      expect(isCapabilityJobEnabled('portal.read')).toBe(true)
    })

    it('keeps promotable jobs registered while scoped execution remains policy-gated', () => {
      expect(isCapabilityJobEnabled('notification.send_email')).toBe(true)
      expect(isCapabilityJobEnabled('goal.use')).toBe(true)
      expect(isCapabilityJobEnabled('portal.guest_media')).toBe(true)
      expect(checkGlobalCapability('notification.send_email').allowed).toBe(false)
    })
  })

  describe('restore-isolated mode (BQC-7.8)', () => {
    afterEach(() => {
      delete process.env.RESTORE_MODE
    })

    it('denies a CORE capability even when the installed store allows it', () => {
      process.env.RESTORE_MODE = 'isolated'
      const ctx = buildTestAuthContext()
      const decision = checkBetaCapability(ctx, 'identity.invite')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('capability_disabled')
    })

    it('denies a NON-CORE capability even when the installed store allowlists the org', () => {
      process.env.RESTORE_MODE = 'isolated'
      const ctx = buildTestAuthContext()
      initCapabilityPolicyStore(
        makeStore({
          isCapabilityGloballyEnabled: () => false,
          isOrgAllowlisted: () => true,
        }),
      )
      const decision = checkBetaCapability(ctx, 'goal.use')
      expect(decision.allowed).toBe(false)
    })

    it('denies the global check and the job gate (schedules stay dark)', () => {
      process.env.RESTORE_MODE = 'isolated'
      expect(checkGlobalCapability('identity.invite').allowed).toBe(false)
      expect(isCapabilityJobEnabled('identity.invite')).toBe(false)
    })

    it('keeps blocked capabilities denied with the blocked reason', () => {
      process.env.RESTORE_MODE = 'isolated'
      const ctx = buildTestAuthContext()
      const decision = checkBetaCapability(ctx, 'gbp.reply.auto_publish')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('capability_blocked')
    })

    it('restores the installed store the moment RESTORE_MODE is unset', () => {
      process.env.RESTORE_MODE = 'isolated'
      const ctx = buildTestAuthContext()
      expect(checkBetaCapability(ctx, 'identity.invite').allowed).toBe(false)
      delete process.env.RESTORE_MODE
      expect(checkBetaCapability(ctx, 'identity.invite').allowed).toBe(true)
    })
  })
})
