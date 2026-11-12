// ADR 0049 — switched-off feature containment matrix.
//
// A switched-off group refuses on every entry path: the server function, the
// route shell, the unscoped guest gate and delayed work. Positive P1/P2 scope
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

/** A capability of each switched group, with the label its route answers under. */
const SWITCHED: ReadonlyArray<
  Readonly<{ capability: Capability; switchName: string; label: string }>
> = [
  { capability: 'property.import_gbp_v2', switchName: 'google', label: 'Google' },
  { capability: 'ai.analyze', switchName: 'ai', label: 'AI' },
  { capability: 'portal.public_read', switchName: 'guest_pages', label: 'Portals' },
  { capability: 'notification.send_email', switchName: 'optional_email', label: 'Email' },
]

function install(env: Readonly<Record<string, string>>): void {
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore(env))
}

beforeEach(() => {
  resetCapabilityPolicyStore()
})

afterEach(() => {
  resetCapabilityPolicyStore()
  resetExecutionPolicy()
})

describe('switched-off feature containment matrix', () => {
  describe('policy/server: requireExecutionAllowed refuses a switched-off group', () => {
    for (const { capability, switchName } of SWITCHED) {
      it(`${capability} refuses while ${switchName} is off`, async () => {
        install({ BETA_CAPABILITIES_OFF: switchName })
        initExecutionPolicy(
          createExecutionPolicy({ listAccessiblePropertyIds: async () => [] }),
        )
        const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
        await expect(
          requireExecutionAllowed({ actor: ctx, action: 'property.read', capability }),
        ).rejects.toMatchObject({
          _tag: 'AuthError',
          code: 'capability_disabled',
          status: 403,
        })
      })
    }
  })

  describe('routes: a switched-off feature answers in the shell', () => {
    for (const { capability, switchName, label } of SWITCHED) {
      it(`${capability} (${label}) says it is not part of this beta`, () => {
        install({ BETA_CAPABILITIES_OFF: switchName })
        const decision = checkScopedCapability(
          {
            organizationId: 'org-controlled-route',
            propertyId: 'property-controlled-route',
          },
          capability,
        )
        let thrown: unknown
        try {
          denyControlledRoute(decision, {
            capability,
            featureLabel: label,
            propertyId: 'property-controlled-route',
          })
        } catch (err) {
          thrown = err
        }
        expect(thrown).toMatchObject({
          routeId: '/_authenticated',
          data: { cause: 'feature', title: label, category: 'not_in_beta' },
        })
      })
    }
  })

  it('answers a suspended Organization as paused and lets another through', () => {
    install({ BETA_SUSPENDED_ORGS: 'org-suspended' })
    const data = {
      capability: 'goal.use' as const,
      featureLabel: 'Goals',
      propertyId: 'p',
    }

    expect(() =>
      denyControlledRoute(
        checkScopedCapability({ organizationId: 'org-other' }, 'goal.use'),
        data,
      ),
    ).not.toThrow()
    let thrown: unknown
    try {
      denyControlledRoute(
        checkScopedCapability({ organizationId: 'org-suspended' }, 'goal.use'),
        data,
      )
    } catch (err) {
      thrown = err
    }
    expect(thrown).toMatchObject({
      data: { cause: 'feature', title: 'Goals', category: 'temporarily_unavailable' },
    })
  })

  describe('public handlers: the guest surface refuses while guest pages are off', () => {
    it('assertGlobalCapability throws for every guest capability and nothing else', () => {
      install({ BETA_CAPABILITIES_OFF: 'guest_pages' })
      const scope = { organizationId: 'org-dark-matrix' }
      for (const capability of [
        'portal.public_read',
        'portal.guest_response',
        'portal.guest_text',
      ] as const) {
        expect(() => assertGlobalCapability(capability), capability).toThrow(
          BetaCapabilityError,
        )
        expect(checkScopedCapability(scope, capability).reason, capability).toBe(
          'capability_disabled',
        )
      }
      expect(checkScopedCapability(scope, 'portal.write').allowed).toBe(true)
      expect(checkScopedCapability(scope, 'portal.upload').allowed).toBe(true)
    })
  })

  describe('delayed contract', () => {
    it('refuses unknown work and the optional email digest while optional email is off', async () => {
      install({ BETA_CAPABILITIES_OFF: 'optional_email' })
      const policy = createDelayedExecutionPolicy({ refreshPolicy: async () => {} })
      const cases: ReadonlyArray<readonly [string, string]> = [
        ['system:unknown.action', 'unknown_action'],
        ['system:notification.email_digest', 'capability_disabled'],
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

  describe('AI capabilities', () => {
    it('deny at the global gate while AI is off; Property Trends stays retired', () => {
      install({ BETA_CAPABILITIES_OFF: 'ai' })
      const scope = { organizationId: 'org-dark-matrix' }
      for (const cap of [
        'ai.analyze',
        'ai.generate_reply',
        'ai.detect_trends',
      ] as const) {
        expect(() => assertGlobalCapability(cap), cap).toThrow(BetaCapabilityError)
        expect(checkScopedCapability(scope, cap).allowed, cap).toBe(false)
      }
      install({})
      expect(checkScopedCapability(scope, 'ai.generate_reply').allowed).toBe(true)
      expect(checkScopedCapability(scope, 'ai.detect_trends').reason).toBe(
        'capability_blocked',
      )
    })
  })
})
