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
import { createDispatcherHandler, createEventDispatcher } from './dispatcher'
import { PrerequisiteNotReadyError } from './prerequisite-not-ready'
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
import { insertOutboxRow, type Tx } from './commit'
import { getDatabaseScope } from '#/shared/db/tenant-scope.server'
import { overrideEventDescriptor } from '#/shared/testing/event-descriptor-overrides'

vi.mock('#/shared/events/registry.server', async (importOriginal) => {
  const { withEventDescriptorOverrides } =
    await import('#/shared/testing/event-descriptor-overrides')
  return withEventDescriptorOverrides(
    await importOriginal<typeof import('#/shared/events/registry.server')>(),
  )
})

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

beforeEach(() => {
  overrideEventDescriptor({
    aggregate: { type: 'event', id: 'eventId' },
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

    await createEventDispatcher(repo, { consumers: consumerRegistry })(makeEnvelope())

    expect(handler).toHaveBeenCalledOnce()
    expect(decideMock).toHaveBeenCalledTimes(1)
    expect(decideMock.mock.calls[0][0]).toMatchObject({
      principal: { kind: 'system', id: 'consumer:c-allow' },
      action: 'system:inbox.project_review',
      executionKind: 'consumer',
      correlationId: 'evt-gate-1',
    })
  })

  it("runs an allowed consumer under the event's Organization", async () => {
    decideMock.mockResolvedValue(ALLOW)
    const seen: unknown[] = []
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-scope',
      module: TEST_MODULE,
      handler: async () => {
        seen.push(getDatabaseScope())
        return { status: 'applied' as const }
      },
    })

    await createEventDispatcher(makeRepo(), { consumers: consumerRegistry })(
      makeEnvelope(),
    )

    expect(seen).toEqual([
      { kind: 'tenant', organizationId: 'org-1', entry: 'consumer', name: 'c-scope' },
    ])
  })

  it('stamps consumer-emitted facts with the delivered event as their cause', async () => {
    decideMock.mockResolvedValue(ALLOW)
    const values = vi.fn(async (_row: unknown) => undefined)
    const tx = { insert: vi.fn(() => ({ values })) } as unknown as Tx
    const handler = vi.fn(async () => {
      // The delivered event's context is the cause of any fact the consumer
      // records in its own transaction.
      await insertOutboxRow(tx, {
        _tag: TEST_EVENT_TYPE,
        eventId: 'evt-child-1',
        resourceId: 'res-child-1',
        organizationId: 'org-1',
        propertyId: null,
        correlationId: null,
      } as unknown as DomainEvent)
      return { status: 'applied' as const }
    })
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-causal',
      module: TEST_MODULE,
      handler,
    })

    await createEventDispatcher(makeRepo(), { consumers: consumerRegistry })(
      makeEnvelope({ commandId: 'command-root-1' }),
    )

    expect(values).toHaveBeenCalledOnce()
    expect(values.mock.calls[0]?.[0]).toMatchObject({
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
      createEventDispatcher(repo, { consumers: consumerRegistry })(makeEnvelope()),
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

    await createEventDispatcher(repo, { consumers: consumerRegistry })(makeEnvelope())

    expect(handler).not.toHaveBeenCalled()
    expect(decideMock).not.toHaveBeenCalled()
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

    await createEventDispatcher(repo, { consumers: consumerRegistry })(makeEnvelope())

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

    await createEventDispatcher(makeRepo(), { consumers: consumerRegistry })(
      makeEnvelope(),
    )

    expect(decideMock).toHaveBeenCalledTimes(2)
    const actionByPrincipal: Record<string, string> = Object.fromEntries(
      decideMock.mock.calls.map(([req]) => [req.principal.id, req.action]),
    )
    // Distinct modules ⇒ distinct catalogue actions.
    expect(actionByPrincipal).toEqual({
      'consumer:c-inbox': 'system:inbox.project_review',
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
      createEventDispatcher(repo, { consumers: consumerRegistry })(makeEnvelope()),
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
    overrideEventDescriptor({
      aggregate: { type: 'event', id: 'eventId' },
      type: DURABLE_TYPE,
      version: 1,
      schema: z.object({ resourceId: z.string() }),
    })
    const repo = makeRepo()

    await expect(
      createEventDispatcher(repo, { consumers: consumerRegistry })(
        makeEnvelope({ eventType: DURABLE_TYPE }),
      ),
    ).rejects.toThrow(new RegExp(DURABLE_TYPE))

    expect(loggerMocks.error).toHaveBeenCalled()
  })

  it('audit-only event type (catalogued without consumers) completes with a debug log', async () => {
    // `metric.recorded` is recorded for audit and read by no consumer.
    const AUDIT_ONLY_TYPE = 'metric.recorded'
    overrideEventDescriptor({
      aggregate: { type: 'event', id: 'eventId' },
      type: AUDIT_ONLY_TYPE,
      version: 1,
      schema: z.object({ resourceId: z.string() }),
    })
    const repo = makeRepo()

    await expect(
      createEventDispatcher(repo, { consumers: consumerRegistry })(
        makeEnvelope({ eventType: AUDIT_ONLY_TYPE }),
      ),
    ).resolves.toBeUndefined()

    expect(loggerMocks.debug).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: AUDIT_ONLY_TYPE }),
      expect.stringMatching(/no consumers/i),
    )
  })

  it('a job without a work ID throws UnrecoverableError (no retry)', async () => {
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

  it('schema validation failure throws UnrecoverableError with a content-free reason', async () => {
    const repo = makeRepo()
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-any',
      module: TEST_MODULE,
      handler: vi.fn(async () => ({ status: 'applied' as const })),
    })

    await expect(
      createEventDispatcher(repo, { consumers: consumerRegistry })(
        makeEnvelope({ payload: { wrong: 'shape' } }),
      ),
    ).rejects.toThrow(UnrecoverableError)

    // Content-free: the reason carries the type/version fingerprint only.
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: TEST_EVENT_TYPE }),
      expect.stringMatching(/schema validation/i),
    )
  })
})

describe('a consumer waiting for its prerequisite', () => {
  function register(name: string, handler: () => Promise<{ status: 'applied' }>) {
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: name,
      module: TEST_MODULE,
      handler,
    })
  }

  it('retries the job as a wait, logging info and no error', async () => {
    decideMock.mockResolvedValue(ALLOW)
    register('c-waits', async () => {
      throw new PrerequisiteNotReadyError('waiting for the item')
    })

    await expect(
      createEventDispatcher(makeRepo(), { consumers: consumerRegistry })(makeEnvelope()),
    ).rejects.toBeInstanceOf(PrerequisiteNotReadyError)

    expect(loggerMocks.error).not.toHaveBeenCalled()
    expect(loggerMocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ consumerName: 'c-waits' }),
      expect.stringMatching(/prerequisite not ready/),
    )
  })

  it('still invokes the other consumers while one waits', async () => {
    decideMock.mockResolvedValue(ALLOW)
    const other = vi.fn(async () => ({ status: 'applied' as const }))
    register('c-waits', async () => {
      throw new PrerequisiteNotReadyError('waiting')
    })
    register('c-other', other)

    await expect(
      createEventDispatcher(makeRepo(), { consumers: consumerRegistry })(makeEnvelope()),
    ).rejects.toBeInstanceOf(PrerequisiteNotReadyError)

    expect(other).toHaveBeenCalledOnce()
  })

  it('still logs a real failure as an error, and fails the job as one', async () => {
    decideMock.mockResolvedValue(ALLOW)
    register('c-waits', async () => {
      throw new PrerequisiteNotReadyError('waiting')
    })
    register('c-breaks', async () => {
      throw new Error('projection boom')
    })

    const failure = await createEventDispatcher(makeRepo(), {
      consumers: consumerRegistry,
    })(makeEnvelope()).catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure).not.toBeInstanceOf(PrerequisiteNotReadyError)
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ consumerName: 'c-breaks' }),
      expect.stringMatching(/Consumer handler failed/),
    )
    expect(loggerMocks.error).toHaveBeenCalledTimes(1)
  })
})

describe('a failing consumer in the log', () => {
  async function failWith(thrown: unknown) {
    decideMock.mockResolvedValue(ALLOW)
    consumerRegistry.registerConsumer({
      eventType: TEST_EVENT_TYPE,
      consumerName: 'c-breaks',
      module: TEST_MODULE,
      handler: () => Promise.reject(thrown),
    })
    return createEventDispatcher(makeRepo(), { consumers: consumerRegistry })(
      makeEnvelope(),
    ).catch((err: unknown) => err)
  }

  it('names the error and its first message line, so an operator can tell failures apart', async () => {
    const failure = await failWith(new TypeError('projection boom\nstack-like detail'))

    expect(failure).toBeInstanceOf(AggregateError)
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        consumerName: 'c-breaks',
        failureReason: 'TypeError: projection boom',
      }),
      expect.stringMatching(/Consumer handler failed/),
    )
  })

  it('reports an unknown name for something that is not an error, and still fails the job', async () => {
    const failure = await failWith({ code: 'refused' })

    expect(failure).toBeInstanceOf(AggregateError)
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ consumerName: 'c-breaks', failureReason: 'unknown: ' }),
      expect.stringMatching(/Consumer handler failed/),
    )
  })
})
