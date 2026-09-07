// BQC-2.5 — delayed/system policy contract tests.
//
// Runs the exported contract fixtures through decideDelayed and pins the
// contract rules: strong read only for external-effect actions (from the
// catalogue), stale_context never overrides the fresh decision, missing
// scope denies, unavailable policy denies closed.

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createDelayedExecutionPolicy,
  getDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  registerDelayedExecutionPolicyInit,
  resetDelayedExecutionPolicy,
  requiresFreshRead,
  capabilityForSystemAction,
  type DelayedPolicyDeps,
} from './system-execution-policy'
import { EXECUTION_POLICY_VERSION } from './execution-policy'
import { DELAYED_CONTRACT_FIXTURES } from './system-execution-policy.fixtures'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from './beta-capabilities'
import { ENTRY_POINT_CATALOGUE } from '#/shared/governance/entry-point-catalogue'

afterEach(() => {
  resetCapabilityPolicyStore()
})

describe('delayed/system policy contract (BQC-2.5)', () => {
  for (const fixture of DELAYED_CONTRACT_FIXTURES) {
    it(fixture.name, async () => {
      resetCapabilityPolicyStore()
      initCapabilityPolicyStore(createEnvCapabilityPolicyStore(fixture.env))

      const refreshPolicy = vi.fn(async () => {})
      const hasActiveConsent = vi.fn(async () => false)
      const deps: DelayedPolicyDeps = {
        refreshPolicy,
        hasActiveConsent,
      }
      const policy = createDelayedExecutionPolicy(deps)
      const decision = await policy.decide({
        ...fixture.request,
        now: new Date('2026-07-17T12:00:00Z'),
      })

      expect(decision.outcome).toBe(fixture.expect.outcome)
      if (fixture.expect.reason) expect(decision.reason).toBe(fixture.expect.reason)
      expect(decision.freshRead).toBe(fixture.expect.freshRead)
      expect(refreshPolicy).toHaveBeenCalledTimes(fixture.expect.freshRead ? 1 : 0)
      if (fixture.request.consent) {
        expect(hasActiveConsent).toHaveBeenCalledWith({
          organizationId: fixture.request.organizationId,
          ...fixture.request.consent,
          at: new Date('2026-07-17T12:00:00Z'),
        })
      }
      // stale_context annotates — the fresh decision itself is never overridden.
      if (fixture.expect.outcome === 'stale_context') {
        expect(decision.allowed).toBe(true)
      } else {
        expect(decision.allowed).toBe(fixture.expect.outcome === 'allow')
      }
    })
  }

  it('unavailable policy state denies closed (strong read failure)', async () => {
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
    const policy = createDelayedExecutionPolicy({
      refreshPolicy: async () => {
        throw new Error('policy store down')
      },
    })
    const decision = await policy.decide({
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:review.sync',
      organizationId: 'org-fixture',
      propertyId: 'd4000000-0000-4000-8000-000000000051',
      executionKind: 'worker',
      now: new Date(),
    })
    expect(decision.outcome).toBe('deny')
    expect(decision.reason).toBe('policy_unavailable')
    expect(decision.allowed).toBe(false)
  })

  it('denies an enqueue capability that disagrees with the catalogue', async () => {
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
    const policy = createDelayedExecutionPolicy({ refreshPolicy: async () => {} })

    const decision = await policy.decide({
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:review.reconcile',
      organizationId: 'org-fixture',
      executionKind: 'worker',
      capabilityAtEnqueue: 'goal.use',
      now: new Date(),
    })

    expect(decision).toMatchObject({
      allowed: false,
      outcome: 'deny',
      reason: 'capability_mismatch',
    })
  })

  it('allows an ungated tenant-cross schedule to enumerate targets', async () => {
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
    const policy = createDelayedExecutionPolicy({ refreshPolicy: async () => {} })

    const decision = await policy.decide({
      principal: { kind: 'system', id: 'schedule:review-reconciliation' },
      action: 'system:review.reconcile',
      organizationId: 'tenant-cross',
      executionKind: 'schedule',
      now: new Date(),
    })

    expect(decision).toMatchObject({
      allowed: true,
      outcome: 'allow',
      reason: 'allowed',
    })
  })

  it('never aliases one delayed action to different capabilities', () => {
    const capabilitiesByAction = new Map<string, Set<string>>()
    for (const row of ENTRY_POINT_CATALOGUE) {
      if (!['job', 'consumer', 'schedule'].includes(row.kind)) continue
      const capabilities = capabilitiesByAction.get(row.action) ?? new Set<string>()
      if (row.capability !== 'none') capabilities.add(row.capability)
      capabilitiesByAction.set(row.action, capabilities)
    }

    const conflicts = [...capabilitiesByAction]
      .filter(([, capabilities]) => capabilities.size > 1)
      .map(
        ([action, capabilities]) => `${action}: ${[...capabilities].sort().join(', ')}`,
      )

    expect(conflicts).toEqual([])
  })

  it('catalogue-derived contract data: capability, fresh read, scope per action', () => {
    expect(capabilityForSystemAction('system:review.sync')).toBe('property.connect_gbp')
    expect(capabilityForSystemAction('system:reply.publish')).toBe(
      'property.publish_reply',
    )
    expect(capabilityForSystemAction('system:notification.email_digest')).toBe(
      'notification.send_email',
    )
    expect(capabilityForSystemAction('system:metric.refresh')).toBe('none')
    expect(capabilityForSystemAction('system:inbox.update')).toBe('inbox.use')
    expect(capabilityForSystemAction('system:inbox.project_guest_feedback')).toBe(
      'portal.read',
    )
    expect(requiresFreshRead('system:review.sync')).toBe(true)
    expect(requiresFreshRead('system:reply.publish')).toBe(true)
    expect(requiresFreshRead('system:review.reconcile')).toBe(false)
    expect(requiresFreshRead('system:inbox.update')).toBe(false)
  })

  it('returns the complete content-free decision consumed by JobRuntime', async () => {
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
    const policy = createDelayedExecutionPolicy({ refreshPolicy: async () => {} })
    const decision = await policy.decide({
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:review.reconcile',
      organizationId: 'org-fixture',
      executionKind: 'schedule',
      policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
      correlationId: 'corr-delayed-1',
      now: new Date(),
    })
    expect(decision).toEqual({
      outcome: 'allow',
      allowed: true,
      reason: 'allowed',
      action: 'system:review.reconcile',
      policyVersion: EXECUTION_POLICY_VERSION,
      policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
      freshRead: false,
    })
  })
})

describe('registerDelayedExecutionPolicyInit (cold-boot lazy init)', () => {
  it('still throws when uninitialized and no initializer is registered', () => {
    resetDelayedExecutionPolicy()
    expect(() => getDelayedExecutionPolicy()).toThrow(/not initialized/)
  })

  it('fires the registered initializer on first read (the cold-boot race fix)', () => {
    resetDelayedExecutionPolicy()
    const stub = createDelayedExecutionPolicy({ refreshPolicy: async () => {} })
    const install = vi.fn(() => initDelayedExecutionPolicy(stub))
    registerDelayedExecutionPolicyInit(install)

    expect(getDelayedExecutionPolicy()).toBe(stub)
    expect(install).toHaveBeenCalledTimes(1)

    // Second read uses the installed policy — the initializer does not re-fire.
    expect(getDelayedExecutionPolicy()).toBe(stub)
    expect(install).toHaveBeenCalledTimes(1)
  })
})
