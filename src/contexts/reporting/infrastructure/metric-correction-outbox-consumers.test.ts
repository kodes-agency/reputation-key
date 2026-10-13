import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import type { ReconcileMetricCorrection } from '../application/use-cases/reconcile-metric-correction'

const mocks = vi.hoisted(() => ({
  registerConsumer: vi.fn(),
  validateEventPayload: vi.fn(
    (_type: string, _version: number, payload: unknown) => payload,
  ),
}))

vi.mock('#/shared/events/schema-registry', () => ({
  validateEventPayload: mocks.validateEventPayload,
}))

// ARC-03-T7: the consumers register on the registry they are handed, so the
// spy is a stand-in registry rather than a mocked module export.
const consumerRegistry = {
  registerConsumer: mocks.registerConsumer,
} as unknown as ConsumerRegistry

import {
  GOAL_METRIC_CORRECTION_CONSUMER,
  registerGoalMetricCorrectionConsumer,
} from './metric-correction-outbox-consumers'

const payload = {
  correctionId: '10000000-0000-4000-8000-000000000001',
  correctedReadingId: '10000000-0000-4000-8000-000000000002',
  replacementReadingId: '10000000-0000-4000-8000-000000000003',
  organizationId: 'org-1',
  propertyId: '10000000-0000-4000-8000-000000000004',
  definitionVersionId: '10000000-0000-4000-8000-000000000005',
  sourceEventId: 'source-event-2',
  supersededSourceEventId: 'source-event-1',
  occurredAt: '2026-08-16T12:00:00.000Z',
}

const event = (overrides: Partial<ConsumerEvent> = {}): ConsumerEvent => ({
  eventId: '10000000-0000-4000-8000-000000000006',
  eventType: 'metric.corrected',
  eventVersion: 2,
  payload,
  organizationId: payload.organizationId,
  propertyId: payload.propertyId,
  sourceContext: 'metric',
  sourceAggregateId: payload.correctionId,
  ...overrides,
})

const reconciled = {
  impactCount: 2,
  candidateCount: 1,
  revised: 1,
  unchanged: 0,
}

type Handler = (event: ConsumerEvent) => Promise<{ status: string }>

/**
 * Registers the consumer over a receipt store that records what was written.
 * `steps` is the order in which reconciliation and the receipt happened.
 */
function registerWith(reconcile: ReconcileMetricCorrection) {
  const steps: string[] = []
  const receipts: Array<Readonly<{ table: unknown; row: unknown }>> = []
  const db = {
    insert: (table: unknown) => ({
      values: (row: unknown) => ({
        onConflictDoNothing: async () => {
          steps.push('receipt')
          receipts.push({ table, row })
        },
      }),
    }),
  } as unknown as Database
  registerGoalMetricCorrectionConsumer(consumerRegistry, {
    reconcile: async (input) => {
      const result = await reconcile(input)
      steps.push('reconciled')
      return result
    },
    db,
  })
  const handler = mocks.registerConsumer.mock.calls.at(-1)?.[0].handler as Handler
  return { handler, steps, receipts }
}

describe('Goal Metric correction durable consumer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateEventPayload.mockImplementation(
      (_type: string, _version: number, value: unknown) => value,
    )
  })

  it('registers a stable consumer and invokes the Goal-owned command', async () => {
    const reconcile = vi.fn(async () => reconciled)
    const { handler } = registerWith(reconcile)
    const registration = mocks.registerConsumer.mock.calls[0]?.[0] as {
      eventType: string
      consumerName: string
      module: string
    }

    expect(registration).toMatchObject({
      eventType: 'metric.corrected',
      consumerName: GOAL_METRIC_CORRECTION_CONSUMER,
      module: GOAL_METRIC_CORRECTION_CONSUMER,
    })
    await expect(handler(event())).resolves.toEqual({ status: 'applied' })
    expect(mocks.validateEventPayload).toHaveBeenCalledWith(
      'metric.corrected',
      2,
      payload,
    )
    expect(reconcile).toHaveBeenCalledWith({
      organizationId: payload.organizationId,
      propertyId: payload.propertyId,
      definitionVersionId: payload.definitionVersionId,
      correctedReadingId: payload.correctedReadingId,
      replacementReadingId: payload.replacementReadingId,
    })
  })

  it('records its own receipt for the delivered fact, after reconciliation has completed', async () => {
    const { handler, steps, receipts } = registerWith(async () => reconciled)

    await handler(event())

    expect(steps).toEqual(['reconciled', 'receipt'])
    expect(receipts).toEqual([
      {
        table: eventConsumerReceipts,
        row: {
          eventId: event().eventId,
          consumerName: GOAL_METRIC_CORRECTION_CONSUMER,
          status: 'applied',
        },
      },
    ])
  })

  it('rejects missing or mismatched property attribution before reconciliation', async () => {
    const reconcile = vi.fn(async () => reconciled)
    const { handler, receipts } = registerWith(reconcile)

    await expect(handler(event({ propertyId: null }))).rejects.toThrow(
      'Goal metric-correction envelope attribution mismatch',
    )
    await expect(handler(event({ organizationId: 'other-org' }))).rejects.toThrow(
      'Goal metric-correction envelope attribution mismatch',
    )
    expect(reconcile).not.toHaveBeenCalled()
    expect(receipts).toEqual([])
  })

  it('does not acknowledge the event when closed-result reconciliation must retry', async () => {
    const { handler, receipts } = registerWith(async () => {
      throw new Error('Goal metric correction reconciliation is pending')
    })

    await expect(handler(event())).rejects.toThrow(
      'Goal metric correction reconciliation is pending',
    )
    expect(receipts).toEqual([])
  })
})
