// BQC-3.2 — durable dispatcher gate tests.
//
// The dispatcher authorizes each consumer through gateDispatcherConsumer
// after the receipt check and before invoking the handler. Terminal denies
// skip the consumer WITHOUT writing a receipt (a typed 'denied' receipt
// status is BQC-3.6 dispatcher correction; the dispatcher is off in
// production under OUTBOX_DISPATCHER_ENABLED). Retry denies rethrow so the
// BullMQ job fails and retries.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Job } from 'bullmq'
import { z } from 'zod'
import { registerEventSchema, clearEventSchemas } from '#/shared/events/schema-registry'
import {
  registerConsumer,
  clearConsumers,
  createDispatcherHandler,
  type ConsumerEvent,
} from './dispatcher'
import type { OutboxRepository } from './infrastructure/outbox-repository'
import {
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
  type DelayedDecision,
  type DelayedDecisionRequest,
} from '#/shared/auth/system-execution-policy'

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => loggerMocks,
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

// ── Test setup (pattern from outbox-crash-boundaries.test.ts) ───────

const TEST_EVENT_TYPE = 'test.dispatcher_gate'
const TEST_EVENT_VERSION = 1

const decideMock = vi.fn<(r: DelayedDecisionRequest) => Promise<DelayedDecision>>()

function decision(over: Partial<DelayedDecision> = {}): DelayedDecision {
  return {
    outcome: 'deny',
    allowed: false,
    reason: 'capability_blocked',
    action: 'system:inbox.update',
    policyVersion: 'bqc-2.4',
    freshRead: false,
    ...over,
  }
}

const ALLOW = decision({ outcome: 'allow', allowed: true, reason: 'allowed' })

function makeEnvelope(overrides: Partial<ConsumerEvent> = {}): ConsumerEvent {
  return {
    eventId: 'evt-gate-1',
    eventType: TEST_EVENT_TYPE,
    eventVersion: TEST_EVENT_VERSION,
    payload: { resourceId: 'res-1' },
    organizationId: 'org-1',
    propertyId: null,
    sourceContext: 'test',
    sourceAggregateId: 'res-1',
    ...overrides,
  }
}

function makeRepo() {
  return {
    hasReceipt: vi.fn(async () => false),
  } as unknown as OutboxRepository
}

function fakeJob(envelope: ConsumerEvent): Job {
  return {
    id: envelope.eventId,
    name: envelope.eventType,
    data: envelope,
  } as unknown as Job
}

beforeEach(() => {
  clearEventSchemas()
  registerEventSchema({
    type: TEST_EVENT_TYPE,
    version: TEST_EVENT_VERSION,
    schema: z.object({ resourceId: z.string() }),
  })
  clearConsumers()
  decideMock.mockReset()
  initDelayedExecutionPolicy({ decide: decideMock })
})

afterEach(() => {
  resetDelayedExecutionPolicy()
  vi.clearAllMocks()
})

describe('dispatcher gate (BQC-3.2)', () => {
  it('invokes the consumer when the gate allows', async () => {
    decideMock.mockResolvedValue(ALLOW)
    const handler = vi.fn(async () => ({ status: 'applied' as const }))
    registerConsumer({ eventType: TEST_EVENT_TYPE, consumerName: 'c-allow', handler })
    const repo = makeRepo()

    await createDispatcherHandler(repo)(fakeJob(makeEnvelope()))

    expect(handler).toHaveBeenCalledOnce()
    expect(decideMock).toHaveBeenCalledTimes(1)
    expect(decideMock.mock.calls[0][0]).toMatchObject({
      principal: { kind: 'system', id: 'consumer:c-allow' },
      action: 'system:inbox.update',
      executionKind: 'consumer',
      correlationId: 'evt-gate-1',
    })
  })

  it('terminal deny skips the consumer without a receipt and without throwing', async () => {
    decideMock.mockResolvedValue(decision({ reason: 'org_suspended' }))
    const handler = vi.fn(async () => ({ status: 'applied' as const }))
    registerConsumer({ eventType: TEST_EVENT_TYPE, consumerName: 'c-deny', handler })
    const repo = makeRepo()

    await expect(
      createDispatcherHandler(repo)(fakeJob(makeEnvelope())),
    ).resolves.toBeUndefined()

    expect(repo.hasReceipt).toHaveBeenCalledWith('evt-gate-1', 'c-deny')
    expect(handler).not.toHaveBeenCalled()
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-gate-1',
        consumerName: 'c-deny',
        reason: 'org_suspended',
      }),
      'delayed execution denied — terminal (consumer skipped, no receipt)',
    )
  })

  it('retry deny rethrows so the BullMQ job fails and retries', async () => {
    decideMock.mockResolvedValue(
      decision({ reason: 'policy_unavailable', freshRead: true }),
    )
    const handler = vi.fn(async () => ({ status: 'applied' as const }))
    registerConsumer({ eventType: TEST_EVENT_TYPE, consumerName: 'c-retry', handler })
    const repo = makeRepo()

    await expect(createDispatcherHandler(repo)(fakeJob(makeEnvelope()))).rejects.toThrow(
      /policy_unavailable/,
    )

    expect(handler).not.toHaveBeenCalled()
  })

  it('receipt check still short-circuits before the gate', async () => {
    const handler = vi.fn(async () => ({ status: 'applied' as const }))
    registerConsumer({ eventType: TEST_EVENT_TYPE, consumerName: 'c-dup', handler })
    const repo = {
      hasReceipt: vi.fn(async () => true),
    } as unknown as OutboxRepository

    await createDispatcherHandler(repo)(fakeJob(makeEnvelope()))

    expect(handler).not.toHaveBeenCalled()
    expect(decideMock).not.toHaveBeenCalled()
  })
})
