import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'

const mocks = vi.hoisted(() => ({
  registerConsumer: vi.fn(),
  validateEventPayload: vi.fn(
    (_type: string, _version: number, payload: unknown) => payload,
  ),
}))

vi.mock('#/shared/outbox', () => ({ registerConsumer: mocks.registerConsumer }))
vi.mock('#/shared/events/schema-registry', () => ({
  validateEventPayload: mocks.validateEventPayload,
}))

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

describe('Goal Metric correction durable consumer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateEventPayload.mockImplementation(
      (_type: string, _version: number, value: unknown) => value,
    )
  })

  it('registers a stable consumer and invokes the Goal-owned command', async () => {
    const reconcile = vi.fn(async () => ({
      impactCount: 2,
      candidateCount: 1,
      revised: 1,
      unchanged: 0,
    }))
    registerGoalMetricCorrectionConsumer(reconcile)
    const registration = mocks.registerConsumer.mock.calls[0]?.[0] as {
      eventType: string
      consumerName: string
      module: string
      handler: (event: ConsumerEvent) => Promise<{ status: string }>
    }

    expect(registration).toMatchObject({
      eventType: 'metric.corrected',
      consumerName: GOAL_METRIC_CORRECTION_CONSUMER,
      module: GOAL_METRIC_CORRECTION_CONSUMER,
    })
    await expect(registration.handler(event())).resolves.toEqual({ status: 'applied' })
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

  it('rejects missing or mismatched property attribution before reconciliation', async () => {
    const reconcile = vi.fn()
    registerGoalMetricCorrectionConsumer(reconcile)
    const handler = mocks.registerConsumer.mock.calls[0]?.[0].handler as (
      event: ConsumerEvent,
    ) => Promise<unknown>

    await expect(handler(event({ propertyId: null }))).rejects.toThrow(
      'Goal metric-correction envelope attribution mismatch',
    )
    await expect(handler(event({ organizationId: 'other-org' }))).rejects.toThrow(
      'Goal metric-correction envelope attribution mismatch',
    )
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('does not acknowledge the event when closed-result reconciliation must retry', async () => {
    const reconcile = vi.fn(async () => {
      throw new Error('Goal metric correction reconciliation is pending')
    })
    registerGoalMetricCorrectionConsumer(reconcile)
    const handler = mocks.registerConsumer.mock.calls[0]?.[0].handler as (
      event: ConsumerEvent,
    ) => Promise<unknown>

    await expect(handler(event())).rejects.toThrow(
      'Goal metric correction reconciliation is pending',
    )
  })
})
