// The outbox's delivery contract at its crash boundaries (PRE17A A3).
//
// A fact commits with its state, is published at least once and is applied
// once. This file runs the production relay and dispatcher over a fake
// repository and a fake queue and breaks each hand-over that needs neither
// PostgreSQL nor Redis: boundaries 2, 3 and 5 below. The others need a real
// transaction or a real queue and are held where one runs.
//
//   1. Crash before the business commit: no state and no outbox row.
//      Each context's command store suite, against PostgreSQL: a failed fact
//      insert rolls the state back (`reply-command-store.test.ts`,
//      `inbox-command-store.test.ts`, `identity-command-store.test.ts`, …).
//   2. After the commit, before the queue add: the row stays unpublished and
//      the next poll adds it. Here, and `relay.test.ts`.
//   3. After the queue add, before `published_at`: the relay adds the fact
//      again under its own id, so the queue still holds one job. Here.
//   4. Consumer state change before its receipt commits: both roll back.
//      `inbox-command-store.test.ts` ("rolls back item + fact when the receipt
//      insert fails"), against PostgreSQL.
//   5. After the consumer commit, before the acknowledgement: the redelivered
//      job finds the receipt and applies nothing. Here, and end to end in
//      `infrastructure/repositories/durable-cutover.test.ts`.
//   6. Worker killed during a handler: redelivery is BullMQ's stalled-job
//      recovery, which this repository does not test. What it owns is that a
//      redelivered job is safe (5) and that a published fact still missing a
//      receipt is dispatched again (`published-event-redelivery.integration.test.ts`).
//   7. Redis unavailable: the command commits regardless (1), nothing is
//      marked published (2, and `relay.test.ts` with no queue at all), and the
//      row waits for a poll that reaches the queue.
//
// The schema-registry, registration and envelope cases at the top are the
// contracts those hand-overs rest on.

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

/**
 * `outbox_events` and `event_consumer_receipts` as the relay and dispatcher
 * see them: a row is claimed again on every poll until it is marked published,
 * and a receipt, once written, is found by every later delivery.
 */
function fakeOutbox(rows: readonly UnpublishedEvent[]) {
  const published = new Set<string>()
  const receipts = new Set<string>()
  const repo = {
    claimUnpublished: vi.fn(async () => rows.filter((row) => !published.has(row.id))),
    markPublished: vi.fn(async (id: string) => {
      published.add(id)
    }),
    renewLease: vi.fn(async (ids: readonly string[]) => ids.length),
    hasReceipt: vi.fn(async (eventId: string, consumer: string) =>
      receipts.has(`${eventId}:${consumer}`),
    ),
    insertReceipt: vi.fn(async (eventId: string, consumer: string) => {
      receipts.add(`${eventId}:${consumer}`)
    }),
  }
  return {
    repo: repo as unknown as OutboxRepository,
    markPublished: repo.markPublished,
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
    it('keeps a fact unpublished when the queue add fails, and the next poll adds it (boundary 2)', async () => {
      const outbox = fakeOutbox([committedFact()])
      const { queue, add, jobIds } = fakeQueue()
      add.mockRejectedValueOnce(new Error('redis unavailable'))
      const relay = createOutboxRelay(outbox.repo, queue, { relayId: 'relay-test' })

      await relay.poll()

      // The add failed, so nothing may say the fact was handed over.
      expect(jobIds).toEqual([])
      expect([...outbox.published]).toEqual([])

      await relay.poll()

      expect(jobIds).toEqual(['evt-001'])
      expect([...outbox.published]).toEqual(['evt-001'])
    })

    it('adds a fact again under its own id when the crash fell before published_at (boundary 3)', async () => {
      const outbox = fakeOutbox([committedFact()])
      const { queue, jobIds } = fakeQueue()
      outbox.markPublished.mockRejectedValueOnce(new Error('connection lost'))
      const relay = createOutboxRelay(outbox.repo, queue, { relayId: 'relay-test' })

      // The queue has the job; the row could not be marked.
      await expect(relay.poll()).rejects.toThrow('connection lost')
      expect([...outbox.published]).toEqual([])

      await relay.poll()

      // Same job id both times: BullMQ keeps one job per id, so the second add
      // is the queue's no-op and not a second delivery.
      expect(jobIds).toEqual(['evt-001', 'evt-001'])
      expect([...outbox.published]).toEqual(['evt-001'])
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
