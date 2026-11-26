// BQC-3.2 — delayed execution gate tests.
//
// The gate is the single decision point for delayed/system execution: workers,
// schedule firings, bus consumers, and the durable dispatcher all authorize
// through it against the BQC-2.5 contract. These tests pin:
//   1. request building from the entry-point catalogue + job/event envelope
//      (org from payload, TENANT_CROSS_ORG sentinel for tenant_cross/none
//      rows, resolver-provided property scope, content-free policy context);
//   2. outcome mapping (allowed / denied — every deny is terminal);
//   3. the REAL BQC-2.5 policy driven by the shared DELAYED_CONTRACT_FIXTURES
//      envs (execution ownership: BQC-2 IMPLEMENTS the contract, BQC-3
//      INTEGRATES it — the same fixtures prove both sides).

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  gateJob,
  createJobExecutionEnvelope,
  gateDispatcherConsumer,
  TENANT_CROSS_ORG,
} from './delayed-execution-gate'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
  type DelayedDecision,
  type DelayedDecisionRequest,
} from '#/shared/auth/system-execution-policy'
import { DELAYED_CONTRACT_FIXTURES } from '#/shared/auth/system-execution-policy.fixtures'
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  type CapabilityPolicyEnv,
} from '#/shared/auth/beta-capabilities'
import type { ConsumerEvent } from '#/shared/outbox/envelope'

const PROP = 'd4000000-0000-4000-8000-000000000051'
const decideMock = vi.fn<(r: DelayedDecisionRequest) => Promise<DelayedDecision>>()

function installStub(): void {
  decideMock.mockReset()
  initDelayedExecutionPolicy({ decide: decideMock })
}

function decision(over: Partial<DelayedDecision> = {}): DelayedDecision {
  return {
    outcome: 'deny',
    allowed: false,
    reason: 'capability_blocked',
    action: 'system:review.sync',
    policyVersion: 'bqc-2.4',
    freshRead: false,
    ...over,
  }
}

const ALLOW = decision({ outcome: 'allow', allowed: true, reason: 'allowed' })

function lastRequest(): DelayedDecisionRequest {
  expect(decideMock).toHaveBeenCalledTimes(1)
  return decideMock.mock.calls[0][0]
}

/** Install the REAL BQC-2.5 policy against a fixture env. */
function installRealPolicy(env: CapabilityPolicyEnv) {
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore(env))
  initDelayedExecutionPolicy(createDelayedExecutionPolicy())
}

function fixtureEnv(namePart: string): CapabilityPolicyEnv {
  const fixture = DELAYED_CONTRACT_FIXTURES.find((f) => f.name.includes(namePart))
  if (!fixture) throw new Error(`fixture not found: ${namePart}`)
  return fixture.env
}

afterEach(() => {
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
})

describe('gateJob — request building (stubbed policy)', () => {
  it('builds the request from the catalogue row and the org/property-scoped payload', async () => {
    installStub()
    decideMock.mockResolvedValue(ALLOW)

    const outcome = await gateJob(
      'sync-property-reviews',
      {
        propertyId: PROP,
        organizationId: 'org-1',
        connectionId: 'c-1',
        locationName: 'l',
      },
      'worker:default',
      'worker',
    )

    expect(outcome.allowed).toBe(true)
    expect(lastRequest()).toMatchObject({
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:review.sync',
      organizationId: 'org-1',
      propertyId: PROP,
      executionKind: 'worker',
    })
  })

  it('stamps the TENANT_CROSS_ORG sentinel for tenant_cross rows without a payload org', async () => {
    installStub()
    decideMock.mockResolvedValue(ALLOW)

    await gateJob('retention-sweep', {}, 'schedule:retention-sweep', 'schedule')

    const request = lastRequest()
    expect(request.organizationId).toBe(TENANT_CROSS_ORG)
    expect(request.action).toBe('system:retention.sweep')
    expect(request.executionKind).toBe('schedule')
  })

  it('stamps the sentinel for none-scope rows (health-check schedule firing)', async () => {
    installStub()
    decideMock.mockResolvedValue(ALLOW)

    await gateJob('health-check', {}, 'schedule:health-check', 'schedule')

    const request = lastRequest()
    expect(request.organizationId).toBe(TENANT_CROSS_ORG)
    expect(request.action).toBe('system:health.check')
  })

  it('leaves organizationId empty for org-scoped rows without a payload org (missing_scope)', async () => {
    installStub()
    decideMock.mockResolvedValue(
      decision({ reason: 'missing_scope', action: 'system:notification.email_urgent' }),
    )

    const outcome = await gateJob('urgent-email', {}, 'worker:default', 'worker')

    expect(lastRequest().organizationId).toBe('')
    expect(outcome.allowed).toBe(false)
  })

  it('passes unknown job names through so decide() denies unknown_action', async () => {
    installStub()
    decideMock.mockResolvedValue(
      decision({ reason: 'unknown_action', action: 'mystery-job' }),
    )

    const outcome = await gateJob(
      'mystery-job',
      { organizationId: 'org-1' },
      'worker:default',
      'worker',
    )

    expect(lastRequest().action).toBe('mystery-job')
    expect(outcome.allowed).toBe(false)
  })

  it('resolves property scope via the resolver when the payload has no propertyId', async () => {
    installStub()
    decideMock.mockResolvedValue(ALLOW)
    const resolver = vi.fn(async () => PROP)

    await gateJob(
      'publish-reply',
      { replyId: 'reply-1', organizationId: 'org-1' },
      'worker:default',
      'worker',
      resolver,
    )

    expect(resolver).toHaveBeenCalledWith('publish-reply', {
      replyId: 'reply-1',
      organizationId: 'org-1',
    })
    expect(lastRequest().propertyId).toBe(PROP)
  })

  it('does not call the resolver when the payload already carries propertyId', async () => {
    installStub()
    decideMock.mockResolvedValue(ALLOW)
    const resolver = vi.fn(async () => 'other-prop')

    await gateJob(
      'sync-property-reviews',
      { propertyId: PROP, organizationId: 'org-1' },
      'worker:default',
      'worker',
      resolver,
    )

    expect(resolver).not.toHaveBeenCalled()
    expect(lastRequest().propertyId).toBe(PROP)
  })

  it('leaves propertyId undefined when neither payload nor resolver provides it', async () => {
    installStub()
    decideMock.mockResolvedValue(ALLOW)

    await gateJob(
      'publish-reply',
      { replyId: 'reply-1', organizationId: 'org-1' },
      'worker:default',
      'worker',
    )

    expect(lastRequest().propertyId).toBeUndefined()
  })

  it('stamps the envelope with the current policy version and refuses an empty scope', () => {
    const base = {
      organizationId: 'org-1',
      propertyId: PROP,
      capability: 'ai.generate_reply' as const,
      initiator: { kind: 'user' as const, id: 'user-9' },
    }

    expect(createJobExecutionEnvelope({ ...base, correlationId: 'corr-1' })).toEqual({
      ...base,
      correlationId: 'corr-1',
      policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
    })
    expect(() => createJobExecutionEnvelope({ ...base, organizationId: '' })).toThrow(
      'requires organizationId',
    )
  })

  it('forwards the flat content-free execution envelope', async () => {
    installStub()
    decideMock.mockResolvedValue(ALLOW)

    await gateJob(
      'publish-reply',
      {
        replyId: 'reply-1',
        organizationId: 'org-1',
        propertyId: PROP,
        capability: 'gbp.reply.publish',
        initiator: { kind: 'user', id: 'user-9' },
        correlationId: 'corr-1',
        policyVersionAtEnqueue: 'bqc-0.3',
      },
      'worker:default',
      'worker',
    )

    expect(lastRequest()).toMatchObject({
      capabilityAtEnqueue: 'gbp.reply.publish',
      initiator: { kind: 'user', id: 'user-9' },
      correlationId: 'corr-1',
      policyVersionAtEnqueue: 'bqc-0.3',
    })
  })
})

describe('gateJob — outcome mapping (stubbed policy)', () => {
  it('maps an allowed decision to allow', async () => {
    installStub()
    decideMock.mockResolvedValue(ALLOW)
    const outcome = await gateJob('health-check', {}, 'worker:default', 'worker')
    expect(outcome).toEqual(ALLOW)
  })

  it('maps every deny reason to a denial', async () => {
    installStub()
    for (const reason of [
      'capability_blocked',
      'capability_disabled',
      'org_suspended',
      'missing_scope',
      'capability_mismatch',
      'unknown_action',
    ] as const) {
      decideMock.mockResolvedValue(decision({ reason }))
      const outcome = await gateJob('health-check', {}, 'worker:default', 'worker')
      expect(outcome.allowed, reason).toBe(false)
    }
  })
})

describe('gateDispatcherConsumer (stubbed policy)', () => {
  it('builds the request from the durable envelope with eventId correlation', async () => {
    installStub()
    decideMock.mockResolvedValue(ALLOW)
    const envelope: ConsumerEvent = {
      eventId: 'evt-9',
      eventType: 'review.created',
      eventVersion: 1,
      payload: {},
      organizationId: 'org-1',
      propertyId: PROP,
      sourceContext: 'review',
      sourceAggregateId: 'rev-1',
    }

    const outcome = await gateDispatcherConsumer(
      'inbox.on-review-created',
      'inbox.outbox-consumers',
      envelope,
    )

    expect(outcome.allowed).toBe(true)
    expect(lastRequest()).toMatchObject({
      principal: { kind: 'system', id: 'consumer:inbox.on-review-created' },
      action: 'system:inbox.project_review',
      resourceScope: 'organization',
      organizationId: 'org-1',
      propertyId: PROP,
      executionKind: 'consumer',
      correlationId: 'evt-9',
    })
  })

  it("names the consumer module's own row scope, not the scope of a job sharing its action", async () => {
    installStub()
    decideMock.mockResolvedValue(ALLOW)

    await gateDispatcherConsumer(
      'notification.on-identity-member-removed',
      'notification.identity-account-outbox-consumers',
      {
        eventId: 'evt-10',
        eventType: 'identity.member.removed',
        eventVersion: 1,
        payload: {},
        organizationId: 'org-1',
        propertyId: null,
        sourceContext: 'identity',
        sourceAggregateId: 'user-1',
      },
    )

    expect(lastRequest()).toMatchObject({
      action: 'system:notification.insert',
      resourceScope: 'organization',
      propertyId: undefined,
    })
  })
})

describe('gateJob against the REAL BQC-2.5 policy (shared contract fixtures)', () => {
  it('current allow — GBP sync with capability and fresh read', async () => {
    installRealPolicy(fixtureEnv('current allow'))

    const outcome = await gateJob(
      'sync-property-reviews',
      {
        propertyId: PROP,
        organizationId: 'org-fixture',
        connectionId: 'c-1',
        locationName: 'l',
        policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
      },
      'worker:default',
      'worker',
    )

    expect(outcome.allowed).toBe(true)
    expect(outcome.outcome).toBe('allow')
    expect(outcome.freshRead).toBe(true)
  })

  it('org-suspended deny — suspension after enqueue denies at dispatch (terminal)', async () => {
    installRealPolicy(fixtureEnv('org suspended'))

    const outcome = await gateJob(
      'sync-property-reviews',
      {
        propertyId: PROP,
        organizationId: 'org-fixture',
        connectionId: 'c-1',
        locationName: 'l',
      },
      'worker:default',
      'worker',
    )

    expect(outcome.allowed).toBe(false)
    expect(outcome.reason).toBe('org_suspended')
  })

  it('capability-killed deny — a stale allow in the queue never overrides a current deny', async () => {
    installRealPolicy(fixtureEnv('Google switched off'))

    const outcome = await gateJob(
      'sync-property-reviews',
      {
        propertyId: PROP,
        organizationId: 'org-fixture',
        connectionId: 'c-1',
        locationName: 'l',
        policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
      },
      'worker:default',
      'worker',
    )

    expect(outcome.allowed).toBe(false)
    expect(outcome.reason).toBe('capability_disabled')
  })

  it('stale_context annotation — envelope version differs; fresh allow stands', async () => {
    installRealPolicy(fixtureEnv('stale_context'))

    const outcome = await gateJob(
      'publish-reply',
      {
        replyId: 'reply-1',
        organizationId: 'org-fixture',
        propertyId: PROP,
        policyVersionAtEnqueue: 'bqc-0.3',
      },
      'worker:default',
      'worker',
    )

    expect(outcome.allowed).toBe(true)
    expect(outcome.outcome).toBe('stale_context')
    expect(outcome.allowed).toBe(true)
  })

  it('reconcile-ambiguous-publications sweep allows under its own tenant-cross action (regression: shared system:review.sync scope merge denied it missing_scope)', async () => {
    installRealPolicy({})

    const outcome = await gateJob(
      'reconcile-ambiguous-publications',
      {},
      'schedule:reconcile-ambiguous-publications',
      'schedule',
    )

    // Tenant-cross + capability 'none' + the distinct system:review.reconcile
    // action → allow under the sentinel org (no property required).
    expect(outcome.allowed).toBe(true)
    expect(outcome.action).toBe('system:review.reconcile')
    expect(outcome.freshRead).toBe(false)
  })

  it('goal-program.maintain firing allows under its tenant-cross row (regression: a property-scoped consumer sharing system:goal.maintain denied it missing_scope)', async () => {
    installRealPolicy({})

    const outcome = await gateJob(
      'goal-program.maintain',
      {},
      'schedule:goal-program.maintain',
      'schedule',
    )

    expect(outcome.allowed).toBe(true)
    expect(outcome.action).toBe('system:goal.maintain')
  })
})
