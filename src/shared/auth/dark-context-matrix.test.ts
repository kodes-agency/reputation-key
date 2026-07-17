// BQC-2.6 — dark-context containment matrix (negative tests).
//
// For Team, Portal, Guest, Goal, Badge, Leaderboard, and AI, the matrix
// proves the interactive/policy layer fails closed — policy/server/command
// negative tests, not positive E2E opened by global capability overrides
// (phase BQC-2 §2.6). BQC-3 proves delayed-runtime denial; BQC-6 adds
// browser/direct-navigation evidence.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  requireExecutionAllowed,
  createExecutionPolicy,
  initExecutionPolicy,
  resetExecutionPolicy,
} from './execution-policy'
import { gateDarkRoute } from './dark-route-gate'
import { createDelayedExecutionPolicy } from './system-execution-policy'
import {
  assertGlobalCapability,
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  type Capability,
} from './beta-capabilities'
import { buildTestAuthContext } from '#/shared/testing/fixtures'

/** Dark capabilities and their default-posture deny reasons. */
const DARK: ReadonlyArray<
  Readonly<{ capability: Capability; reason: string; label: string }>
> = [
  { capability: 'portal.write', reason: 'capability_blocked', label: 'Portals' },
  { capability: 'portal.upload', reason: 'capability_blocked', label: 'Portals' },
  { capability: 'portal.read', reason: 'org_not_allowlisted', label: 'Portals' },
  { capability: 'team.use', reason: 'org_not_allowlisted', label: 'Teams' },
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

describe('BQC-2.6 dark-context containment matrix', () => {
  describe('policy/server: requireExecutionAllowed denies every dark capability', () => {
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

  describe('routes: gateDarkRoute redirects to the intentional unavailable page', () => {
    for (const { capability, label } of DARK) {
      it(`${capability} (${label}) redirects to /unavailable`, async () => {
        try {
          await gateDarkRoute(capability, label)
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

  describe('public handlers: guest surface denies while portal.read is dark', () => {
    it('assertGlobalCapability(portal.read) throws — guest fns deny', () => {
      expect(() => assertGlobalCapability('portal.read')).toThrow()
    })

    it('blocked portal.write/upload throw at the global gate too', () => {
      expect(() => assertGlobalCapability('portal.write')).toThrow()
      expect(() => assertGlobalCapability('portal.upload')).toThrow()
    })
  })

  describe('delayed contract: dark job/schedule actions deny (BQC-2.5 contract)', () => {
    it('goal/badge/leaderboard reconcile + email digest deny with stable reasons', async () => {
      const policy = createDelayedExecutionPolicy({ refreshPolicy: async () => {} })
      const cases: ReadonlyArray<readonly [string, string]> = [
        ['system:goal.reconcile', 'org_not_allowlisted'],
        ['system:badge.reconcile', 'org_not_allowlisted'],
        ['system:leaderboard.reconcile', 'org_not_allowlisted'],
        ['system:notification.email_digest', 'capability_blocked'],
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
        expect(() => assertGlobalCapability(cap), cap).toThrow()
      }
    })
  })
})
