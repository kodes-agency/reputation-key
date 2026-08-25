// BQC-2.6 / ADR 0049 — controlled-feature containment matrix.
//
// Team, Portal, Guest, Goal, Badge, Leaderboard, email, and AI stay off by
// default. Most are promotable through scoped persisted policy; portal.upload
// is temporarily safety-blocked. This file keeps the negative default-posture
// contract; positive P1/P2 scope tests live with ExecutionPolicy and the
// product journeys.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  requireExecutionAllowed,
  createExecutionPolicy,
  initExecutionPolicy,
  resetExecutionPolicy,
} from './execution-policy'
import { redirectDeniedControlledRoute } from './controlled-route-gate'
import { createDelayedExecutionPolicy } from './system-execution-policy'
import {
  assertGlobalCapability,
  BetaCapabilityError,
  createEnvCapabilityPolicyStore,
  checkScopedCapability,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  type Capability,
} from './beta-capabilities'
import { buildTestAuthContext } from '#/shared/testing/fixtures'

/** Controlled capabilities and their effective default-posture deny reasons. */
const DARK: ReadonlyArray<
  Readonly<{ capability: Capability; reason: string; label: string }>
> = [
  { capability: 'portal.write', reason: 'org_not_allowlisted', label: 'Portals' },
  { capability: 'portal.upload', reason: 'capability_blocked', label: 'Portals' },
  { capability: 'portal.read', reason: 'org_not_allowlisted', label: 'Portals' },
  { capability: 'team.use', reason: 'capability_blocked', label: 'Teams' },
  { capability: 'goal.use', reason: 'org_not_allowlisted', label: 'Goals' },
  { capability: 'badge.use', reason: 'org_not_allowlisted', label: 'Recognition' },
  { capability: 'leaderboard.use', reason: 'org_not_allowlisted', label: 'Leaderboard' },
  { capability: 'ai.analyze', reason: 'org_not_allowlisted', label: 'AI' },
]

beforeEach(() => {
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
})

afterEach(() => {
  resetCapabilityPolicyStore()
  resetExecutionPolicy()
})

describe('BQC-2.6 controlled-feature containment matrix', () => {
  describe('policy/server: requireExecutionAllowed denies every unallowlisted capability', () => {
    for (const { capability, reason } of DARK) {
      it(`${capability} denies with ${reason}`, async () => {
        initExecutionPolicy(
          createExecutionPolicy({ listAccessiblePropertyIds: async () => [] }),
        )
        const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
        await expect(
          requireExecutionAllowed({
            actor: ctx,
            action: 'property.read',
            capability,
          }),
        ).rejects.toMatchObject({ _tag: 'AuthError', code: reason, status: 403 })
      })
    }
  })

  describe('routes: gateControlledRoute enforces selected-property policy', () => {
    for (const { capability, label } of DARK) {
      it(`${capability} (${label}) redirects to /unavailable`, async () => {
        try {
          const data = { capability, featureLabel: label }
          const decision = checkScopedCapability(
            { organizationId: 'org-controlled-route' },
            capability,
          )
          redirectDeniedControlledRoute(decision, data)
          expect.unreachable('gate must redirect while dark')
        } catch (err) {
          const redirect = err as {
            options?: { to?: string; search?: { feature?: string } }
          }
          expect(redirect.options?.to).toBe('/unavailable')
          expect(redirect.options?.search?.feature).toBe(label)
        }
      })
    }
  })

  it('allows P1 and redirects P2 for the same allowlisted organization', async () => {
    initCapabilityPolicyStore({
      isCapabilityGloballyEnabled: (capability) => capability === 'goal.use',
      isOrgAllowlisted: (orgId, capability) =>
        orgId === 'org-controlled-route' && capability === 'goal.use',
      isPropertyAllowlisted: (propertyId, capability) =>
        propertyId === 'property-p1' && capability === 'goal.use',
      isOrgSuspended: () => false,
      isPropertySuspended: () => false,
    })

    const p1Data = {
      capability: 'goal.use' as const,
      featureLabel: 'Goals',
      propertyId: 'property-p1',
    }
    expect(() =>
      redirectDeniedControlledRoute(
        checkScopedCapability(
          {
            organizationId: 'org-controlled-route',
            propertyId: 'property-p1',
          },
          'goal.use',
        ),
        p1Data,
      ),
    ).not.toThrow()

    const p2Data = { ...p1Data, propertyId: 'property-p2' }
    await expect(
      Promise.resolve().then(() =>
        redirectDeniedControlledRoute(
          checkScopedCapability(
            {
              organizationId: 'org-controlled-route',
              propertyId: 'property-p2',
            },
            'goal.use',
          ),
          p2Data,
        ),
      ),
    ).rejects.toMatchObject({
      options: { to: '/unavailable', search: { feature: 'Goals' } },
    })
  })

  describe('public handlers: guest surface denies while portal.read is dark', () => {
    it('assertGlobalCapability(portal.read) throws — guest fns deny', () => {
      expect(() => assertGlobalCapability('portal.read')).toThrow(BetaCapabilityError)
    })

    it('promotable portal.write/upload still throw at the unscoped global gate', () => {
      expect(() => assertGlobalCapability('portal.write')).toThrow(BetaCapabilityError)
      expect(() => assertGlobalCapability('portal.upload')).toThrow(BetaCapabilityError)
    })
  })

  describe('delayed contract: dark job/schedule actions deny (BQC-2.5 contract)', () => {
    it('promoted leaderboard reconcile + email digest deny with stable reasons', async () => {
      const policy = createDelayedExecutionPolicy({ refreshPolicy: async () => {} })
      const cases: ReadonlyArray<readonly [string, string]> = [
        ['system:leaderboard.reconcile', 'org_not_allowlisted'],
        ['system:notification.email_digest', 'org_not_allowlisted'],
      ]
      for (const [action, reason] of cases) {
        const decision = await policy.decide({
          principal: { kind: 'system', id: 'schedule:dark' },
          action,
          organizationId: 'org-dark-matrix',
          executionKind: 'schedule',
          now: new Date(),
        })
        expect(decision.allowed, action).toBe(false)
        expect(decision.reason, action).toBe(reason)
      }
    })
  })

  describe('AI capabilities deny everywhere in beta', () => {
    it('ai.analyze / ai.generate_reply / ai.detect_trends deny at the global gate', () => {
      for (const cap of [
        'ai.analyze',
        'ai.generate_reply',
        'ai.detect_trends',
      ] as const) {
        expect(() => assertGlobalCapability(cap), cap).toThrow(BetaCapabilityError)
      }
    })
  })
})
