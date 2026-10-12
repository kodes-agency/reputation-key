// BQC-2.6 / ADR 0049 — controlled-feature containment matrix.
//
// Portal, Guest, Goal, email, and AI stay off by default. Most are promotable
// through scoped persisted policy; only portal.guest_contact is safety-blocked
// (portal.upload became controlled_beta on 2026-10-01, ADR 0063).
// This file keeps the negative default-posture contract; positive P1/P2 scope
// tests live with ExecutionPolicy and the product journeys.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  requireExecutionAllowed,
  createExecutionPolicy,
  initExecutionPolicy,
  resetExecutionPolicy,
} from './execution-policy'
import { denyControlledRoute } from './controlled-route-gate'
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
import type { CapabilityRefusalCategory } from './capability-refusal-category'

/** Controlled capabilities and their effective default-posture deny reasons. */
const DARK: ReadonlyArray<
  Readonly<{
    capability: Capability
    reason: string
    label: string
    category: CapabilityRefusalCategory
  }>
> = [
  {
    capability: 'portal.write',
    reason: 'org_not_allowlisted',
    label: 'Portals',
    category: 'not_enabled_for_organization',
  },
  {
    capability: 'portal.upload',
    reason: 'org_not_allowlisted',
    label: 'Portals',
    category: 'not_enabled_for_organization',
  },
  {
    capability: 'portal.read',
    reason: 'org_not_allowlisted',
    label: 'Portals',
    category: 'not_enabled_for_organization',
  },
  {
    capability: 'goal.use',
    reason: 'org_not_allowlisted',
    label: 'Goals',
    category: 'not_enabled_for_organization',
  },
  {
    capability: 'ai.analyze',
    reason: 'org_not_allowlisted',
    label: 'AI',
    category: 'not_enabled_for_organization',
  },
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
    for (const { capability, label, category } of DARK) {
      it(`${capability} (${label}) answers in the shell with its refusal`, async () => {
        const propertyId = 'property-controlled-route'
        const data = { capability, featureLabel: label, propertyId }
        const decision = checkScopedCapability(
          { organizationId: 'org-controlled-route', propertyId },
          capability,
        )
        let thrown: unknown
        try {
          denyControlledRoute(decision, data)
        } catch (err) {
          thrown = err
        }
        expect(thrown).toMatchObject({
          routeId: '/_authenticated',
          data: { cause: 'feature', title: label, category, propertyId },
        })
      })
    }
  })

  it('allows P1 and refuses P2 for the same allowlisted organization', async () => {
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
      denyControlledRoute(
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
        denyControlledRoute(
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
      data: {
        cause: 'feature',
        title: 'Goals',
        category: 'needs_admin_enablement',
        propertyId: 'property-p2',
      },
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
    it('unknown work is refused while promotable email remains gated', async () => {
      const policy = createDelayedExecutionPolicy({ refreshPolicy: async () => {} })
      const cases: ReadonlyArray<readonly [string, string]> = [
        ['system:unknown.action', 'unknown_action'],
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
