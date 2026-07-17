// BQC-2.5 — delayed/system policy contract tests.
//
// Runs the exported contract fixtures through decideDelayed and pins the
// contract rules: strong read only for external-effect actions (from the
// catalogue), stale_context never overrides the fresh decision, missing
// scope denies, unavailable policy denies closed.

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createDelayedExecutionPolicy,
  requiresFreshRead,
  capabilityForSystemAction,
  type DelayedPolicyDeps,
} from './system-execution-policy'
import type { DecisionAuditEntry } from './execution-policy'
import { DELAYED_CONTRACT_FIXTURES } from './system-execution-policy.fixtures'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from './beta-capabilities'

afterEach(() => {
  resetCapabilityPolicyStore()
})

describe('delayed/system policy contract (BQC-2.5)', () => {
  for (const fixture of DELAYED_CONTRACT_FIXTURES) {
    it(fixture.name, async () => {
      resetCapabilityPolicyStore()
      initCapabilityPolicyStore(createEnvCapabilityPolicyStore(fixture.env))

      const refreshPolicy = vi.fn(async () => {})
      const deps: DelayedPolicyDeps = {
        refreshPolicy,
        hasActiveConsent: async () => false,
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

  it('catalogue-derived contract data: capability, fresh read, scope per action', () => {
    expect(capabilityForSystemAction('system:review.sync')).toBe('property.connect_gbp')
    expect(capabilityForSystemAction('system:reply.publish')).toBe(
      'property.publish_reply',
    )
    expect(capabilityForSystemAction('system:notification.email_digest')).toBe(
      'notification.send_email',
    )
    expect(capabilityForSystemAction('system:metric.refresh')).toBe('none')
    expect(requiresFreshRead('system:review.sync')).toBe(true)
    expect(requiresFreshRead('system:reply.publish')).toBe(true)
    expect(requiresFreshRead('system:metric.refresh')).toBe(false)
    expect(requiresFreshRead('system:inbox.update')).toBe(false)
  })

  it('writes a content-free audit entry per decision (JobRuntime consumes the result)', async () => {
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
    const writeDecisionAudit = vi.fn(async (_entry: DecisionAuditEntry) => {})
    const policy = createDelayedExecutionPolicy({
      refreshPolicy: async () => {},
      writeDecisionAudit,
    })
    const decision = await policy.decide({
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:metric.refresh',
      organizationId: 'org-fixture',
      executionKind: 'schedule',
      policyVersionAtEnqueue: 'bqc-2.4',
      correlationId: 'corr-delayed-1',
      now: new Date(),
    })
    expect(decision.outcome).toBe('allow')
    await vi.waitFor(() => expect(writeDecisionAudit).toHaveBeenCalledTimes(1))
    expect(writeDecisionAudit.mock.calls[0][0]).toMatchObject({
      actorType: 'system',
      actorId: 'worker:default',
      organizationId: 'org-fixture',
      action: 'system:metric.refresh',
      executionKind: 'schedule',
      decision: 'allow',
      policyVersion: 'bqc-2.4',
      correlationId: 'corr-delayed-1',
    })
  })
})
