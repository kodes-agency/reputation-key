// Source state and facts commit together; delivery admission commits before
// enqueue. Consumer receipts prevent duplicate effects after acknowledgement loss.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Job, Queue } from 'bullmq'
import {
  registerEventSchema,
  clearEventSchemas,
  validateEventPayload,
} from '#/shared/events/schema-registry'
import {
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import { createConsumerRegistry, type ConsumerRegistry } from './consumer-registry'
import { createDispatcherHandler } from './dispatcher'
import { buildConsumerEvent, parseConsumerEvent } from './envelope'
import { createOutboxRelay } from './relay'
import { reconcileWorkItems } from '#/shared/jobs/work-items.server'
import { z, ZodError } from 'zod/v4'
import type {
  OutboxRepository,
  UnpublishedEvent,
} from './infrastructure/outbox-repository'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

// ── Test setup ──────────────────────────────────────────────────────

const TEST_EVENT_TYPE = 'test.crash_boundary'
const TEST_EVENT_VERSION = 1

const testSchema = z.object({
  resourceId: z.string(),
  action: z.string(),
})

function setupSchemaRegistry() {
  clearEventSchemas()
  registerEventSchema({
    aggregate: { type: 'event', id: 'eventId' },
    type: TEST_EVENT_TYPE,
    version: TEST_EVENT_VERSION,
    schema: testSchema,
  })
}

/** One committed fact, as the relay claims it from `outbox_events`. */
function committedFact(id = 'evt-001'): UnpublishedEvent {
  return {
    id,
    eventType: TEST_EVENT_TYPE,
    eventVersion: TEST_EVENT_VERSION,
    payload: { resourceId: 'res-1', action: 'created' },
    organizationId: 'org-1',
    propertyId: null,
    sourceContext: 'test',
    sourceAggregateId: 'res-1',
    recordedAt: new Date('2026-07-17T10:00:00.000Z'),
  }
}

/** Facts and durable admission are committed before the queue is called. */
function fakeOutbox(rows: readonly UnpublishedEvent[]) {
  const published = new Set<string>()
  const receipts = new Set<string>()
  const admitted = new Map<
    string,
    { id: string; kind: string; dispatchSequence: number }
  >()
  const schedulePending = vi.fn(async () => {
    const pending = rows.filter((row) => !published.has(row.id))
    for (const row of pending) {
      published.add(row.id)
      admitted.set(row.id, {
        id: `work-${row.id}`,
        kind: 'outbox-delivery',
        dispatchSequence: 1,
      })
    }
    return pending.map((row) => ({
      id: `work-${row.id}`,
      subjectId: row.id,
      organizationId: row.organizationId,
      eventType: row.eventType,
    }))
  })
  const repo = {
    delivery: { schedulePending },
    hasReceipt: vi.fn(async (eventId: string, consumer: string) =>
      receipts.has(`${eventId}:${consumer}`),
    ),
    insertReceipt: vi.fn(async (eventId: string, consumer: string) => {
      receipts.add(`${eventId}:${consumer}`)
    }),
  }
  return {
    repo: repo as unknown as OutboxRepository,
    schedulePending,
    admitted,
    published,
    receipts,
  }
}

/** The dispatch queue: every add the relay made, with the job id it asked for. */
function fakeQueue() {
  const jobIds: unknown[] = []
  const add = vi.fn(async (_name: string, _data: unknown, opts: { jobId?: string }) => {
    jobIds.push(opts.jobId)
    return { id: opts.jobId }
  })
  return { queue: { add } as unknown as Queue, add, jobIds }
}

// ── Schema registry tests ───────────────────────────────────────────

describe('outbox crash boundaries', () => {
  beforeEach(() => {
    setupSchemaRegistry()
    consumerRegistry = createConsumerRegistry()
    // The dispatcher asks current policy before every consumer; these cases
    // are about delivery, so policy allows.
    initDelayedExecutionPolicy({
      decide: async (request) => ({
        outcome: 'allow',
        allowed: true,
        reason: 'allowed',
        action: request.action,
        policyVersion: 'test',
        freshRead: false,
      }),
    })
  })

  afterEach(() => {
    resetDelayedExecutionPolicy()
  })

  describe('schema registry validation', () => {
    it('validates a correct payload', () => {
      const parsed = validateEventPayload(TEST_EVENT_TYPE, TEST_EVENT_VERSION, {
        resourceId: 'res-1',
        action: 'created',
      })
      expect(parsed).toEqual({ resourceId: 'res-1', action: 'created' })
    })

    it('rejects an invalid payload', () => {
      expect(() =>
        validateEventPayload(TEST_EVENT_TYPE, TEST_EVENT_VERSION, { resourceId: 123 }),
      ).toThrow(ZodError)
    })

    it('rejects unknown event type', () => {
      expect(() => validateEventPayload('unknown.event', 1, {})).toThrow(
        /Unknown event type/,
      )
    })

    it('rejects duplicate registration', () => {
      expect(() =>
        registerEventSchema({
          aggregate: { type: 'event', id: 'eventId' },
          type: TEST_EVENT_TYPE,
          version: TEST_EVENT_VERSION,
          schema: testSchema,
        }),
      ).toThrow(/Duplicate event schema/)
    })
  })

  describe('consumer registration', () => {
    it('registers a consumer for an event type', () => {
      const handler = async (): Promise<{ status: 'applied' }> => ({ status: 'applied' })
      expect(() =>
        consumerRegistry.registerConsumer({
          eventType: TEST_EVENT_TYPE,
          consumerName: 'test-consumer',
          module: 'inbox.outbox-consumers',
          handler,
        }),
      ).not.toThrow()
    })

    it('rejects duplicate consumer name for same event type', () => {
      const handler = async (): Promise<{ status: 'applied' }> => ({ status: 'applied' })
      consumerRegistry.registerConsumer({
        eventType: TEST_EVENT_TYPE,
        consumerName: 'dup',
        module: 'inbox.outbox-consumers',
        handler,
      })
      expect(() =>
        consumerRegistry.registerConsumer({
          eventType: TEST_EVENT_TYPE,
          consumerName: 'dup',
          module: 'inbox.outbox-consumers',
          handler,
        }),
      ).toThrow(/Duplicate consumer "dup"/)
    })

    it('allows same consumer name for different event types', () => {
      const handler = async (): Promise<{ status: 'applied' }> => ({ status: 'applied' })
      registerEventSchema({
        aggregate: { type: 'event', id: 'eventId' },
        type: 'other.event',
        version: 1,
        schema: z.object({}),
      })
      consumerRegistry.registerConsumer({
        eventType: TEST_EVENT_TYPE,
        consumerName: 'shared',
        module: 'inbox.outbox-consumers',
        handler,
      })
      expect(() =>
        consumerRegistry.registerConsumer({
          eventType: 'other.event',
          consumerName: 'shared',
          module: 'inbox.outbox-consumers',
          handler,
        }),
      ).not.toThrow()
    })
  })

  describe('relay to dispatcher envelope', () => {
    it('relay→dispatcher envelope includes eventType (BQR-2.1)', () => {
      // Pre-fix: queue.add(name, barePayload) → dispatcher saw eventType undefined.
      const row = committedFact()
      const jobData = buildConsumerEvent(row)
      const parsed = parseConsumerEvent(jobData)
      expect(parsed).not.toBeNull()
      expect(parsed!.eventType).toBe(TEST_EVENT_TYPE)
      expect(parsed!.eventId).toBe('evt-001')
      expect(parseConsumerEvent(row.payload)).toBeNull()
    })
  })

  describe('crash boundaries held without a database or Redis', () => {
    it('retries admission after a crash before the ledger commits', async () => {
      const outbox = fakeOutbox([committedFact()])
      const { queue, jobIds } = fakeQueue()
      outbox.schedulePending.mockRejectedValueOnce(new Error('connection lost'))
      const relay = createOutboxRelay(outbox.repo, queue)

      await expect(relay.poll()).rejects.toThrow('connection lost')
      expect(jobIds).toEqual([])
      expect([...outbox.published]).toEqual([])
      expect(outbox.admitted.size).toBe(0)

      await relay.poll()

      expect(jobIds).toEqual(['work-evt-001-initial'])
      expect([...outbox.published]).toEqual(['evt-001'])
      expect(outbox.admitted.size).toBe(1)
    })

    it('recovers committed admission when the process loses its enqueue acknowledgement', async () => {
      const outbox = fakeOutbox([committedFact()])
      const { queue, add, jobIds } = fakeQueue()
      add.mockRejectedValueOnce(new Error('acknowledgement lost'))
      const relay = createOutboxRelay(outbox.repo, queue)

      await relay.poll()

      expect(jobIds).toEqual([])
      expect([...outbox.published]).toEqual(['evt-001'])
      expect(outbox.admitted.size).toBe(1)
      // An ordinary admission poll cannot create a second work item. The
      // independent ledger reconciler repairs a lost or failed queue add.
      await relay.poll()
      expect(outbox.schedulePending).toHaveBeenCalledTimes(2)
      const recovered = await reconcileWorkItems({
        reserveDispatch: async () => [...outbox.admitted.values()],
        enqueue: async (_kind, data, jobId) => {
          expect(data).toEqual({ workId: 'work-evt-001' })
          return queue.add(TEST_EVENT_TYPE, data, { jobId })
        },
      })

      expect(recovered).toEqual({ queued: 1, failed: 0 })
      expect(jobIds).toEqual(['work-evt-001-1'])
      expect(outbox.admitted.size).toBe(1)
    })

    it('applies nothing when a job is delivered again after its consumer committed (boundary 5)', async () => {
      const outbox = fakeOutbox([])
      const applied: string[] = []
      consumerRegistry.registerConsumer({
        eventType: TEST_EVENT_TYPE,
        consumerName: 'projects-once',
        module: 'inbox.outbox-consumers',
        // As a command store does: the effect and its receipt, together.
        handler: async (event) => {
          applied.push(event.eventId)
          await outbox.repo.insertReceipt(event.eventId, 'projects-once', 'applied')
          return { status: 'applied' }
        },
      })
      const dispatch = createDispatcherHandler(outbox.repo, {
        consumers: consumerRegistry,
      })
      const job = {
        id: 'evt-001',
        name: TEST_EVENT_TYPE,
        data: buildConsumerEvent(committedFact()),
      } as unknown as Job

      await dispatch(job)
      // The worker died before it acknowledged the job, so BullMQ delivers it again.
      await dispatch(job)

      expect(applied).toEqual(['evt-001'])
      expect([...outbox.receipts]).toEqual(['evt-001:projects-once'])
    })
  })
})
