// A `metric.corrected` fact against the real receipt store.
//
// The fact has two catalogued consumers: Metric's and the Goal one. The
// redelivery sweep treats a published fact as delivered only when each of them
// holds a receipt for it, so a consumer that does its work and writes none has
// the fact dispatched again every two hours, three times, and then counted as
// an exhausted delivery until retention removes it.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import type { Job } from 'bullmq'
import { getDb } from '#/shared/db'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  createConsumerRegistry,
  type ConsumerEvent,
} from '#/shared/outbox/consumer-registry'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import {
  CATALOGUED_CONSUMER_EXPECTATIONS,
  createPublishedEventRedeliveryHandler,
  PUBLISHED_EVENT_REDELIVERY_HORIZON_MS,
} from '#/shared/outbox/published-event-redelivery.job'
import type { ReconcileMetricCorrection } from '../application/use-cases/reconcile-metric-correction'
import { registerMetricCorrectionConsumer } from './correction-outbox-consumers'
import {
  GOAL_METRIC_CORRECTION_CONSUMER,
  registerGoalMetricCorrectionConsumer,
} from './metric-correction-outbox-consumers'

const EVENT_TYPE = 'metric.corrected'
const ORGANIZATION_ID = 'goal-metric-correction-receipt-test'
const PROPERTY_ID = '6c000000-0000-4000-8000-000000000001'
const DELIVERED = '6c000000-0000-4000-8000-0000000000e1'
const PENDING = '6c000000-0000-4000-8000-0000000000e2'
const REDELIVERED = '6c000000-0000-4000-8000-0000000000e3'
const EVENT_IDS = [DELIVERED, PENDING, REDELIVERED] as const
// Older than any other row a shared database can hold, so the sweep's oldest-
// first batch always reaches these fixtures.
const PUBLISHED_AT = new Date('2020-01-01T00:00:00.000Z')
const SWEEP_AT = new Date(
  PUBLISHED_AT.getTime() + 2 * PUBLISHED_EVENT_REDELIVERY_HORIZON_MS,
)

const EXPECTED_CONSUMERS = CATALOGUED_CONSUMER_EXPECTATIONS.filter(
  (expectation) => expectation.eventType === EVENT_TYPE,
)

const db = getDb()
const outbox = createOutboxRepository(db)

const payload = {
  correctionId: '6c000000-0000-4000-8000-0000000000c1',
  correctedReadingId: '6c000000-0000-4000-8000-0000000000c2',
  replacementReadingId: '6c000000-0000-4000-8000-0000000000c3',
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  definitionVersionId: '6c000000-0000-4000-8000-0000000000c4',
  sourceEventId: 'goal-metric-correction-source-2',
  supersededSourceEventId: 'goal-metric-correction-source-1',
  occurredAt: PUBLISHED_AT.toISOString(),
  staffAttribution: null,
}

const eventOf = (eventId: string): ConsumerEvent => ({
  eventId,
  eventType: EVENT_TYPE,
  eventVersion: 2,
  payload,
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  sourceContext: 'metric',
  sourceAggregateId: payload.correctionId,
})

const reconciled: ReconcileMetricCorrection = async () => ({
  impactCount: 2,
  candidateCount: 1,
  revised: 1,
  unchanged: 0,
})

const stillPending: ReconcileMetricCorrection = async () => {
  throw new Error('Goal metric correction reconciliation is pending')
}

/** Hands the fact to every registered consumer, as one dispatch does. */
async function deliver(
  eventId: string,
  reconcile: ReconcileMetricCorrection,
): Promise<ReadonlyArray<PromiseSettledResult<unknown>>> {
  const registry = createConsumerRegistry()
  registerMetricCorrectionConsumer(registry, db)
  registerGoalMetricCorrectionConsumer(registry, { reconcile, db })
  return Promise.allSettled(
    registry.listFor(EVENT_TYPE).map((consumer) => consumer.handler(eventOf(eventId))),
  )
}

async function receiptsOf(eventId: string) {
  const rows = await db
    .select({
      consumerName: eventConsumerReceipts.consumerName,
      status: eventConsumerReceipts.status,
    })
    .from(eventConsumerReceipts)
    .where(eq(eventConsumerReceipts.eventId, eventId))
  return rows.sort((left, right) => left.consumerName.localeCompare(right.consumerName))
}

/** Runs the real redelivery sweep and answers which fixture facts it re-dispatched. */
async function sweepRedeliveries(): Promise<readonly string[]> {
  const redelivered: string[] = []
  const sweep = createPublishedEventRedeliveryHandler({
    repo: outbox,
    queue: {
      add: async (_name, data) => {
        redelivered.push((data as { eventId: string }).eventId)
        return undefined
      },
    },
    clock: () => SWEEP_AT,
    logger: { info: vi.fn(), warn: vi.fn() },
    consumerExpectations: EXPECTED_CONSUMERS,
  })
  await sweep({} as Job)
  return redelivered.filter((eventId) => EVENT_IDS.some((id) => id === eventId))
}

async function clearFixture(): Promise<void> {
  // Receipts go with their fact (ON DELETE CASCADE).
  await db.delete(outboxEvents).where(inArray(outboxEvents.id, [...EVENT_IDS]))
}

describe.sequential('Goal metric-correction receipt (real PostgreSQL)', () => {
  beforeAll(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  beforeEach(async () => {
    await clearFixture()
    await db.insert(outboxEvents).values(
      EVENT_IDS.map((id) => ({
        id,
        eventType: EVENT_TYPE,
        eventVersion: 2,
        payload,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceContext: 'metric',
        sourceAggregateId: payload.correctionId,
        createdAt: PUBLISHED_AT,
        publishedAt: PUBLISHED_AT,
      })),
    )
  })

  afterAll(async () => {
    await clearFixture()
    clearEventSchemas()
  })

  it('holds a receipt from every catalogued consumer after one delivery, so the sweep leaves the fact alone', async () => {
    const outcomes = await deliver(DELIVERED, reconciled)

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(await receiptsOf(DELIVERED)).toEqual(
      EXPECTED_CONSUMERS.map(({ consumerName }) => ({
        consumerName,
        status: 'applied',
      })).sort((left, right) => left.consumerName.localeCompare(right.consumerName)),
    )
    expect(EXPECTED_CONSUMERS.map(({ consumerName }) => consumerName)).toContain(
      GOAL_METRIC_CORRECTION_CONSUMER,
    )
    // The two facts no consumer has seen are redelivered; the delivered one is not.
    expect([...(await sweepRedeliveries())].sort()).toEqual([PENDING, REDELIVERED].sort())
  })

  it('writes no Goal receipt while a closed result is still pending, so the fact is delivered again', async () => {
    await deliver(PENDING, stillPending)

    expect(
      (await receiptsOf(PENDING)).map(({ consumerName }) => consumerName),
    ).not.toContain(GOAL_METRIC_CORRECTION_CONSUMER)
    expect(await sweepRedeliveries()).toContain(PENDING)
  })

  it('keeps one receipt when the same fact is delivered twice', async () => {
    await deliver(REDELIVERED, reconciled)
    const again = await deliver(REDELIVERED, reconciled)

    expect(again.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(
      (await receiptsOf(REDELIVERED)).filter(
        ({ consumerName }) => consumerName === GOAL_METRIC_CORRECTION_CONSUMER,
      ),
    ).toEqual([{ consumerName: GOAL_METRIC_CORRECTION_CONSUMER, status: 'applied' }])
  })
})
