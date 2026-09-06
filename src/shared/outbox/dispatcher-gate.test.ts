// BQC-3.2 — durable dispatcher gate tests.
//
// The dispatcher authorizes each consumer through gateDispatcherConsumer
// after the receipt check and before invoking the handler. Retry denies
// rethrow so the BullMQ job fails and retries.
//
// BQC-3.6 dispatcher corrections:
//   - terminal denies write an 'obsolete' receipt (processed without effect)
//     so the denial doesn't re-evaluate forever;
//   - consumer exceptions PROPAGATE after the loop (per-consumer isolation is
//     kept — every consumer is invoked — but the job fails so configured
//     attempts apply; receipts protect already-applied consumers);
//   - malformed envelopes / schema failures are UnrecoverableError (no retry);
//   - an event type with zero registered consumers but a catalogued durable
//     consumer ref is a deployment/config failure (throw → retry); genuinely
//     bus-only types complete with a debug log.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Job } from 'bullmq'
import { UnrecoverableError } from 'bullmq'
import { z } from 'zod/v4'
import { registerEventSchema, clearEventSchemas } from '#/shared/events/schema-registry'
import { createDispatcherHandler } from './dispatcher'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
  type ConsumerEvent,
} from './consumer-registry'
import type { OutboxRepository } from './infrastructure/outbox-repository'
import {
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
  type DelayedDecision,
  type DelayedDecisionRequest,
} from '#/shared/auth/system-execution-policy'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent, withEnvelopeIdentifiers } from './event-adapter'
import { getRequestContext } from '#/shared/observability/request-context'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

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
/** The catalogue consumer row these fixtures are authorized under. */
const TEST_MODULE = 'inbox.outbox-consumers'

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
    insertReceipt: vi.fn(async () => undefined),
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
  consumerRegistry = createConsumerRegistry()
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
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-allow',
      module: TEST_MODULE,
      handler,
    })
    const repo = makeRepo()

    await createDispatcherHandler(repo, { consumers: consumerRegistry })(
      fakeJob(makeEnvelope()),
    )

    expect(handler).toHaveBeenCalledOnce()
    expect(decideMock).toHaveBeenCalledTimes(1)
    expect(decideMock.mock.calls[0][0]).toMatchObject({
      principal: { kind: 'system', id: 'consumer:c-allow' },
      action: 'system:inbox.update',
      executionKind: 'consumer',
      correlationId: 'evt-gate-1',
    })
  })

  it('stamps consumer-emitted facts with the delivered event as their cause', async () => {
    decideMock.mockResolvedValue(ALLOW)
    const insert = vi.fn(async (_event: unknown) => undefined)
    const emittedRepo = { insert } as unknown as OutboxRepository
    const handler = vi.fn(async () => {
      // The same envelope-identifier stamping insertOutboxRow applies inside a
      // command transaction: the delivered event's context is the cause.
      const child = withEnvelopeIdentifiers(
        {
          _tag: TEST_EVENT_TYPE,
          eventId: 'evt-child-1',
          resourceId: 'res-child-1',
          organizationId: 'org-1',
          propertyId: null,
          correlationId: null,
        } as unknown as DomainEvent,
        getRequestContext(),
      )
      await emittedRepo.insert({ ...toOutboxEvent(child), id: child.eventId })
      return { status: 'applied' as const }
    })
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-causal',
      module: TEST_MODULE,
      handler,
    })

    await createDispatcherHandler(makeRepo(), { consumers: consumerRegistry })(
      fakeJob(makeEnvelope({ commandId: 'command-root-1' })),
    )

    expect(insert).toHaveBeenCalledOnce()
    expect(insert.mock.calls[0]?.[0]).toMatchObject({
      payload: {
        causationId: 'evt-gate-1',
        commandId: 'command-root-1',
      },
    })
  })

  it('terminal deny skips the consumer and writes an obsolete receipt (BQC-3.6)', async () => {
    decideMock.mockResolvedValue(decision({ reason: 'org_suspended' }))
    const handler = vi.fn(async () => ({ status: 'applied' as const }))
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-deny',
      module: TEST_MODULE,
      handler,
    })
    const repo = makeRepo()

    await expect(
      createDispatcherHandler(repo, { consumers: consumerRegistry })(
        fakeJob(makeEnvelope()),
      ),
    ).resolves.toBeUndefined()

    expect(repo.hasReceipt).toHaveBeenCalledWith('evt-gate-1', 'c-deny')
    expect(handler).not.toHaveBeenCalled()
    // BQC-3.6: 'obsolete' = "processed without effect" — the terminal denial
    // is recorded so it does not re-evaluate forever on redelivery.
    expect(repo.insertReceipt).toHaveBeenCalledWith('evt-gate-1', 'c-deny', 'obsolete')
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        consumerName: 'c-deny',
        reason: 'org_suspended',
      }),
      expect.stringMatching(/denied — terminal/),
    )
  })

  it('terminal-deny receipt short-circuits re-delivery (no re-evaluation)', async () => {
    const handler = vi.fn(async () => ({ status: 'applied' as const }))
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-deny',
      module: TEST_MODULE,
      handler,
    })
    // Receipt exists (written by the terminal-deny path on the first pass) —
    // the gate must NOT be consulted again.
    const repo = {
      hasReceipt: vi.fn(async () => true),
      // Shape shared with 'receipt check still short-circuits before the
      // gate' below: stub repo, one dispatch, then "handler and gate never
      // ran". The two assert different things — here that an existing
      // terminal-deny receipt is not re-evaluated, there that ordinary
      // de-duplication precedes the gate at all.
      // Merging them needs a parameter selecting which of the two meanings
      // is under test, which reads worse than either test does alone.
      // Revisit if a third short-circuit reason lands and all three want the
      // same repo stub.
      // fallow-ignore-next-line code-duplication
      insertReceipt: vi.fn(async () => undefined),
    } as unknown as OutboxRepository

    await createDispatcherHandler(repo, { consumers: consumerRegistry })(
      fakeJob(makeEnvelope()),
    )

    expect(handler).not.toHaveBeenCalled()
    expect(decideMock).not.toHaveBeenCalled()
  })

  it('retry deny rethrows so the BullMQ job fails and retries', async () => {
    decideMock.mockResolvedValue(
      decision({ reason: 'policy_unavailable', freshRead: true }),
    )
    const handler = vi.fn(async () => ({ status: 'applied' as const }))
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-retry',
      module: TEST_MODULE,
      handler,
    })
    const repo = makeRepo()

    await expect(
      createDispatcherHandler(repo, { consumers: consumerRegistry })(
        fakeJob(makeEnvelope()),
      ),
    ).rejects.toThrow(/policy_unavailable/)

    expect(handler).not.toHaveBeenCalled()
  })

  it('receipt check still short-circuits before the gate', async () => {
    const handler = vi.fn(async () => ({ status: 'applied' as const }))
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-dup',
      module: TEST_MODULE,
      handler,
    })
    const repo = {
      hasReceipt: vi.fn(async () => true),
    } as unknown as OutboxRepository

    await createDispatcherHandler(repo, { consumers: consumerRegistry })(
      fakeJob(makeEnvelope()),
    )

    expect(handler).not.toHaveBeenCalled()
    expect(decideMock).not.toHaveBeenCalled()
  })

  it('gates each consumer under ITS OWN catalogue module, not a shared one', async () => {
    // Regression pin: the dispatcher used to pass a hardcoded
    // 'inbox.outbox-consumers' for every consumer, so a notification
    // consumer was authorized under inbox's policy action.
    decideMock.mockResolvedValue(ALLOW)
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-inbox',
      module: 'inbox.outbox-consumers',
      handler: vi.fn(async () => ({ status: 'applied' as const })),
    })
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-notification',
      module: 'notification.outbox-consumers',
      handler: vi.fn(async () => ({ status: 'applied' as const })),
    })

    await createDispatcherHandler(makeRepo(), { consumers: consumerRegistry })(
      fakeJob(makeEnvelope()),
    )

    expect(decideMock).toHaveBeenCalledTimes(2)
    const actionByPrincipal: Record<string, string> = Object.fromEntries(
      decideMock.mock.calls.map(([req]) => [req.principal.id, req.action]),
    )
    // Distinct modules ⇒ distinct catalogue actions.
    expect(actionByPrincipal).toEqual({
      'consumer:c-inbox': 'system:inbox.update',
      'consumer:c-notification': 'system:notification.insert',
    })
  })
})

describe('dispatcher corrections (BQC-3.6)', () => {
  it('fails the job after the loop when a consumer throws — other consumers still invoked', async () => {
    decideMock.mockResolvedValue(ALLOW)
    const failing = vi.fn(async () => {
      throw new Error('projection boom')
    })
    const succeeding = vi.fn(async () => ({ status: 'applied' as const }))
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-fails',
      module: TEST_MODULE,
      handler: failing,
    })
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-succeeds',
      module: TEST_MODULE,
      handler: succeeding,
    })
    const repo = makeRepo()

    await expect(
      createDispatcherHandler(repo, { consumers: consumerRegistry })(
        fakeJob(makeEnvelope()),
      ),
    ).rejects.toThrow(/c-fails/)

    // Per-consumer isolation kept: every consumer was invoked this attempt.
    expect(failing).toHaveBeenCalledOnce()
    expect(succeeding).toHaveBeenCalledOnce()
  })

  it('catalogued durable event type with zero registered consumers throws (config failure)', async () => {
    // 'review.created' is catalogued with a durable consumer ref — zero
    // registered consumers means the deployment is misconfigured, so the job
    // must fail and retry (a redeploy fixes it), never silently complete.
    const DURABLE_TYPE = 'review.created'
    registerEventSchema({
      type: DURABLE_TYPE,
      version: 1,
      schema: z.object({ resourceId: z.string() }),
    })
    const repo = makeRepo()

    await expect(
      createDispatcherHandler(repo, { consumers: consumerRegistry })(
        fakeJob(makeEnvelope({ eventType: DURABLE_TYPE })),
      ),
    ).rejects.toThrow(new RegExp(DURABLE_TYPE))

    expect(loggerMocks.error).toHaveBeenCalled()
  })

  it('audit-only event type (catalogued without consumers) completes with a debug log', async () => {
    // `metric.recorded` is recorded for audit and read by no consumer.
    const AUDIT_ONLY_TYPE = 'metric.recorded'
    registerEventSchema({
      type: AUDIT_ONLY_TYPE,
      version: 1,
      schema: z.object({ resourceId: z.string() }),
    })
    const repo = makeRepo()

    await expect(
      createDispatcherHandler(repo, { consumers: consumerRegistry })(
        fakeJob(makeEnvelope({ eventType: AUDIT_ONLY_TYPE })),
      ),
    ).resolves.toBeUndefined()

    expect(loggerMocks.debug).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: AUDIT_ONLY_TYPE }),
      expect.stringMatching(/no consumers/i),
    )
  })

  it('malformed envelope throws UnrecoverableError (no retry, content-free reason)', async () => {
    const repo = makeRepo()
    const job = {
      id: 'evt-bad-1',
      name: 'whatever',
      data: { bare: 'payload' },
    } as unknown as Job

    await expect(
      createDispatcherHandler(repo, { consumers: consumerRegistry })(job),
    ).rejects.toThrow(UnrecoverableError)
  })

  it('rejects a queue-injected envelope stamped by another Data Cell', async () => {
    const repo = makeRepo()
    const handler = vi.fn(async () => ({ status: 'applied' as const }))
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-wrong-cell',
      module: TEST_MODULE,
      handler,
    })

    await expect(
      createDispatcherHandler(repo, { consumers: consumerRegistry, localCell: 'us' })(
        fakeJob(makeEnvelope({ dataCellId: 'europe', region: 'europe' })),
      ),
    ).rejects.toThrow(UnrecoverableError)

    expect(handler).not.toHaveBeenCalled()
    expect(repo.hasReceipt).not.toHaveBeenCalled()
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ localCell: 'us', targetCell: 'europe' }),
      expect.stringMatching(/wrong Data Cell/i),
    )
  })

  it('rejects a Property-less fact whose source Data Cell differs from the worker', async () => {
    const repo = makeRepo()
    const handler = vi.fn(async () => ({ status: 'applied' as const }))
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-wrong-source-cell',
      module: TEST_MODULE,
      handler,
    })

    await expect(
      createDispatcherHandler(repo, { consumers: consumerRegistry, localCell: 'us' })(
        fakeJob(makeEnvelope({ sourceCellId: 'europe', region: 'europe' })),
      ),
    ).rejects.toThrow(UnrecoverableError)

    expect(handler).not.toHaveBeenCalled()
    expect(repo.hasReceipt).not.toHaveBeenCalled()
  })

  it('schema validation failure throws UnrecoverableError with a content-free reason', async () => {
    const repo = makeRepo()
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-any',
      module: TEST_MODULE,
      handler: vi.fn(async () => ({ status: 'applied' as const })),
    })

    await expect(
      createDispatcherHandler(repo, { consumers: consumerRegistry })(
        fakeJob(makeEnvelope({ payload: { wrong: 'shape' } })),
      ),
    ).rejects.toThrow(UnrecoverableError)

    // Content-free: the reason carries the type/version fingerprint only.
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: TEST_EVENT_TYPE }),
      expect.stringMatching(/schema validation/i),
    )
  })
})
