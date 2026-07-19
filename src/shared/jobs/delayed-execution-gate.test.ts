// BQC-3.2 — delayed execution gate tests.
//
// The gate is the single decision point for delayed/system execution: workers,
// schedule firings, bus consumers, and the durable dispatcher all authorize
// through it against the BQC-2.5 contract. These tests pin:
//   1. request building from the entry-point catalogue + job/event envelope
//      (org from payload, TENANT_CROSS_ORG sentinel for tenant_cross/none
//      rows, resolver-provided property scope, content-free policy context);
//   2. outcome mapping (allow / deny_terminal / deny_retry — only
//      policy_unavailable retries; every other deny is terminal);
//   3. the REAL BQC-2.5 policy driven by the shared DELAYED_CONTRACT_FIXTURES
//      envs (execution ownership: BQC-2 IMPLEMENTS the contract, BQC-3
//      INTEGRATES it — the same fixtures prove both sides).

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  gateJob,
  gateBusConsumer,
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
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  type CapabilityPolicyEnv,
} from '#/shared/auth/beta-capabilities'
import type { DomainEvent } from '#/shared/events/events'
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
  const refreshPolicy = vi.fn(async () => {})
  initDelayedExecutionPolicy(createDelayedExecutionPolicy({ refreshPolicy }))
  return refreshPolicy
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

    expect(outcome.kind).toBe('allow')
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
      decision({ reason: 'missing_scope', action: 'system:activity.record' }),
    )

    const outcome = await gateJob('insert-activity-log', {}, 'worker:default', 'worker')

    expect(lastRequest().organizationId).toBe('')
    expect(outcome.kind).toBe('deny_terminal')
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
    expect(outcome.kind).toBe('deny_terminal')
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

  it('forwards the content-free policy envelope (initiator, correlation, version)', async () => {
    installStub()
    decideMock.mockResolvedValue(ALLOW)

    await gateJob(
      'publish-reply',
      {
        replyId: 'reply-1',
        organizationId: 'org-1',
        propertyId: PROP,
        policy: {
          initiator: { kind: 'user', id: 'user-9' },
          correlationId: 'corr-1',
          policyVersionAtEnqueue: 'bqc-0.3',
        },
      },
      'worker:default',
      'worker',
    )

    expect(lastRequest()).toMatchObject({
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
    expect(outcome).toEqual({ kind: 'allow', decision: ALLOW })
  })

  it('maps policy_unavailable to deny_retry (transient — the caller throws for BullMQ retry)', async () => {
    installStub()
    decideMock.mockResolvedValue(
      decision({ reason: 'policy_unavailable', freshRead: true }),
    )
    const outcome = await gateJob('health-check', {}, 'worker:default', 'worker')
    expect(outcome.kind).toBe('deny_retry')
    expect(outcome.decision.reason).toBe('policy_unavailable')
  })

  it('maps every other deny reason to deny_terminal', async () => {
    installStub()
    for (const reason of [
      'capability_blocked',
      'capability_disabled',
      'org_suspended',
      'missing_scope',
      'consent_required',
      'unknown_action',
    ] as const) {
      decideMock.mockResolvedValue(decision({ reason }))
      const outcome = await gateJob('health-check', {}, 'worker:default', 'worker')
      expect(outcome.kind, reason).toBe('deny_terminal')
    }
  })
})

describe('gateBusConsumer (stubbed policy)', () => {
  it('builds the request from the consumer catalogue row and the event', async () => {
    installStub()
    decideMock.mockResolvedValue(ALLOW)
    const event = {
      _tag: 'metric.recorded',
      eventId: 'evt-1',
      organizationId: 'org-1',
      propertyId: PROP,
      correlationId: null,
      occurredAt: new Date(),
    } as unknown as DomainEvent

    const outcome = await gateBusConsumer('metric.event-handlers', event)

    expect(outcome.kind).toBe('allow')
    expect(lastRequest()).toMatchObject({
      principal: { kind: 'system', id: 'consumer:metric.event-handlers' },
      action: 'system:metric.record',
      organizationId: 'org-1',
      propertyId: PROP,
      executionKind: 'consumer',
      // correlationId falls back to the event id when the event carries none
      correlationId: 'evt-1',
    })
  })

  it('passes unknown consumer modules through so decide() denies unknown_action', async () => {
    installStub()
    decideMock.mockResolvedValue(decision({ reason: 'unknown_action' }))
    const event = {
      _tag: 'metric.recorded',
      eventId: 'evt-2',
      organizationId: 'org-1',
      correlationId: 'corr-2',
      occurredAt: new Date(),
    } as unknown as DomainEvent

    const outcome = await gateBusConsumer('mystery.module', event)

    expect(lastRequest().action).toBe('mystery.module')
    expect(lastRequest().correlationId).toBe('corr-2')
    expect(outcome.kind).toBe('deny_terminal')
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

    expect(outcome.kind).toBe('allow')
    expect(lastRequest()).toMatchObject({
      principal: { kind: 'system', id: 'consumer:inbox.on-review-created' },
      action: 'system:inbox.update',
      organizationId: 'org-1',
      propertyId: PROP,
      executionKind: 'consumer',
      correlationId: 'evt-9',
    })
  })
})

describe('gateJob against the REAL BQC-2.5 policy (shared contract fixtures)', () => {
  it('current allow — GBP sync with capability and fresh read', async () => {
    const refreshPolicy = installRealPolicy(fixtureEnv('current allow'))

    const outcome = await gateJob(
      'sync-property-reviews',
      {
        propertyId: PROP,
        organizationId: 'org-fixture',
        connectionId: 'c-1',
        locationName: 'l',
        policy: { policyVersionAtEnqueue: 'bqc-2.4' },
      },
      'worker:default',
      'worker',
    )

    expect(outcome.kind).toBe('allow')
    expect(outcome.decision.outcome).toBe('allow')
    expect(outcome.decision.freshRead).toBe(true)
    expect(refreshPolicy).toHaveBeenCalledTimes(1)
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

    expect(outcome.kind).toBe('deny_terminal')
    expect(outcome.decision.reason).toBe('org_suspended')
  })

  it('capability-killed deny — a stale allow in the queue never overrides a current deny', async () => {
    installRealPolicy(fixtureEnv('capability killed'))

    const outcome = await gateJob(
      'sync-property-reviews',
      {
        propertyId: PROP,
        organizationId: 'org-fixture',
        connectionId: 'c-1',
        locationName: 'l',
        policy: { policyVersionAtEnqueue: 'bqc-2.4' },
      },
      'worker:default',
      'worker',
    )

    expect(outcome.kind).toBe('deny_terminal')
    expect(outcome.decision.reason).toBe('capability_disabled')
  })

  it('stale_context annotation — envelope version differs; fresh allow stands', async () => {
    installRealPolicy(fixtureEnv('stale_context'))

    const outcome = await gateJob(
      'publish-reply',
      {
        replyId: 'reply-1',
        organizationId: 'org-fixture',
        propertyId: PROP,
        policy: { policyVersionAtEnqueue: 'bqc-0.3' },
      },
      'worker:default',
      'worker',
    )

    expect(outcome.kind).toBe('allow')
    expect(outcome.decision.outcome).toBe('stale_context')
    expect(outcome.decision.allowed).toBe(true)
  })

  it('dark deny — goal reconcile schedule firing denies while goal.use is dark', async () => {
    const refreshPolicy = installRealPolicy(fixtureEnv('dark job (goal reconcile)'))

    const outcome = await gateJob(
      'reconcile-goal-progress',
      {},
      'schedule:reconcile-goal-progress',
      'schedule',
    )

    expect(outcome.kind).toBe('deny_terminal')
    expect(outcome.decision.reason).toBe('org_not_allowlisted')
    expect(outcome.decision.freshRead).toBe(false)
    expect(refreshPolicy).not.toHaveBeenCalled()
  })

  it('reconcile-ambiguous-publications sweep allows under its own tenant-cross action (regression: shared system:review.sync scope merge denied it missing_scope)', async () => {
    installRealPolicy(fixtureEnv('dark job (goal reconcile)'))

    const outcome = await gateJob(
      'reconcile-ambiguous-publications',
      {},
      'schedule:reconcile-ambiguous-publications',
      'schedule',
    )

    // Tenant-cross + capability 'none' + the distinct system:review.reconcile
    // action → allow under the sentinel org (no property required).
    expect(outcome.kind).toBe('allow')
    expect(outcome.decision.action).toBe('system:review.reconcile')
    expect(outcome.decision.freshRead).toBe(false)
  })
})
