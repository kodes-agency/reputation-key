// BQC-3.2 — event bus gate tests.
//
// Bus registrations that carry a catalogue consumer identity are authorized
// at emit time through the delayed execution policy. The bus is
// fire-and-forget: a terminal deny skips the handler with a warning, and a
// retry deny skips with an error (no retry semantics in-process — the durable
// dispatcher path is where retries live). Ungoverned registrations (no
// consumer option) behave exactly as before.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createEventBus } from './event-bus'
import type { DomainEvent } from './events'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
  type DelayedDecision,
  type DelayedDecisionRequest,
} from '#/shared/auth/system-execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => loggerMocks,
}))

const decideMock = vi.fn<(r: DelayedDecisionRequest) => Promise<DelayedDecision>>()

function decision(over: Partial<DelayedDecision> = {}): DelayedDecision {
  return {
    outcome: 'deny',
    allowed: false,
    reason: 'capability_blocked',
    action: 'system:metric.record',
    policyVersion: 'bqc-2.4',
    freshRead: false,
    ...over,
  }
}

const ALLOW = decision({ outcome: 'allow', allowed: true, reason: 'allowed' })

function metricRecorded(over: Record<string, unknown> = {}): DomainEvent {
  return {
    _tag: 'metric.recorded',
    eventId: 'evt-bus-1',
    organizationId: 'org-1',
    propertyId: 'd4000000-0000-4000-8000-000000000051',
    correlationId: null,
    occurredAt: new Date(),
    ...over,
  } as unknown as DomainEvent
}

afterEach(() => {
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
  vi.clearAllMocks()
})

describe('event bus emit-time gate (BQC-3.2)', () => {
  it('denies a dark consumer at emit time: goal handler skipped, ungoverned handler runs', async () => {
    // REAL policy against the default (dark) posture — goal.use is not
    // allowlisted, so goal.event-handlers denies org_not_allowlisted.
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
    initDelayedExecutionPolicy(
      createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
    )
    const bus = createEventBus()
    const goalHandler = vi.fn(async () => {})
    const ungoverned = vi.fn(async () => {})
    bus.on('metric.recorded', goalHandler, { consumer: 'goal.event-handlers' })
    bus.on('metric.recorded', ungoverned)

    await bus.emit(metricRecorded())

    expect(goalHandler).not.toHaveBeenCalled()
    expect(ungoverned).toHaveBeenCalledOnce()
  })

  it('invokes a governed handler when the gate allows', async () => {
    decideMock.mockResolvedValue(ALLOW)
    initDelayedExecutionPolicy({ decide: decideMock })
    const bus = createEventBus()
    const handler = vi.fn(async () => {})
    bus.on('metric.recorded', handler, { consumer: 'metric.event-handlers' })

    const event = metricRecorded()
    await bus.emit(event)

    expect(handler).toHaveBeenCalledWith(event)
    expect(decideMock).toHaveBeenCalledTimes(1)
    expect(decideMock.mock.calls[0][0]).toMatchObject({
      principal: { kind: 'system', id: 'consumer:metric.event-handlers' },
      executionKind: 'consumer',
      organizationId: 'org-1',
    })
  })

  it('terminal deny skips the governed handler with a warning; other consumers still run', async () => {
    decideMock.mockResolvedValue(decision({ reason: 'org_suspended' }))
    initDelayedExecutionPolicy({ decide: decideMock })
    const bus = createEventBus()
    const denied = vi.fn(async () => {})
    const other = vi.fn(async () => {})
    bus.on('metric.recorded', denied, { consumer: 'metric.event-handlers' })
    bus.on('metric.recorded', other)

    await expect(bus.emit(metricRecorded())).resolves.toBeUndefined()

    expect(denied).not.toHaveBeenCalled()
    expect(other).toHaveBeenCalledOnce()
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        consumer: 'metric.event-handlers',
        tag: 'metric.recorded',
        reason: 'org_suspended',
      }),
      'delayed execution denied — terminal (event bus consumer skipped)',
    )
  })

  it('retry deny skips with an error log; the emit still resolves (fire-and-forget)', async () => {
    decideMock.mockResolvedValue(
      decision({ reason: 'policy_unavailable', freshRead: true }),
    )
    initDelayedExecutionPolicy({ decide: decideMock })
    const bus = createEventBus()
    const handler = vi.fn(async () => {})
    bus.on('metric.recorded', handler, { consumer: 'metric.event-handlers' })

    await expect(bus.emit(metricRecorded())).resolves.toBeUndefined()

    expect(handler).not.toHaveBeenCalled()
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        consumer: 'metric.event-handlers',
        tag: 'metric.recorded',
        reason: 'policy_unavailable',
      }),
      'delayed execution denied — policy unavailable (event bus consumer skipped)',
    )
  })

  it('ungoverned registrations (no consumer option) never consult the policy', async () => {
    initDelayedExecutionPolicy({ decide: decideMock })
    const bus = createEventBus()
    const handler = vi.fn(async () => {})
    bus.on('metric.recorded', handler)

    await bus.emit(metricRecorded())

    expect(handler).toHaveBeenCalledOnce()
    expect(decideMock).not.toHaveBeenCalled()
  })
})
