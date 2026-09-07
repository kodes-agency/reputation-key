import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerRegistry } from '#/shared/outbox'
import type { Database } from '#/shared/db'

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

import { registerPublicReputationMetricConsumers } from './public-reputation-outbox-consumers'
import type { RecordMetricInput } from '../application/use-cases/record-metric'

const writeReceipt = vi.fn(async () => undefined)
const receiptValues = vi.fn(() => ({ onConflictDoNothing: writeReceipt }))
const receiptDb = {
  insert: vi.fn(() => ({ values: receiptValues })),
} as unknown as Database

const occurredAt = '2026-08-25T12:00:00.000Z'
const payload = {
  reviewId: '00000000-0000-4000-8000-000000000003',
  organizationId: 'org-1',
  propertyId: '00000000-0000-4000-8000-000000000001',
  platform: 'google',
  sourceEpoch: 2,
  sourceRevision: 3,
  analysisSequence: 4,
  occurredAt,
}

const envelope = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'event-review-created',
  eventType: 'review.created',
  eventVersion: 1,
  payload,
  organizationId: payload.organizationId,
  propertyId: payload.propertyId,
  sourceContext: 'review',
  sourceAggregateId: payload.reviewId,
  occurredAt,
  recordedAt: '2026-08-25T12:00:01.000Z',
  ...overrides,
})

describe('Public Reputation metric durable consumer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('registers review.created and records the governed Google rating', async () => {
    const readings: RecordMetricInput[] = []
    registerPublicReputationMetricConsumers(consumerRegistry, {
      recordMetric: vi.fn(async (input: RecordMetricInput) => {
        readings.push(input)
        return { status: 'recorded' as const, reading: {} as never }
      }),
      reviewRatingLookup: {
        getEligibleRatingById: vi.fn(async () => 4),
      },
      db: receiptDb,
    })

    const [registration] = mocks.registerConsumer.mock.calls.map(([value]) => value)
    expect(registration).toMatchObject({
      eventType: 'review.created',
      consumerName: 'metric.public-reputation',
      module: 'metric.public-reputation',
    })
    await expect(registration.handler(envelope())).resolves.toEqual({
      status: 'applied',
    })
    expect(readings).toEqual([
      {
        organizationId: payload.organizationId,
        propertyId: payload.propertyId,
        portalId: null,
        portalGroupId: null,
        definitionVersionId: '11111111-1111-4111-8111-111111111205',
        sourceEventId: 'event-review-created',
        sourcePolicy: 'google_property_derivative',
        scope: 'property',
        value: 4,
        sampleCount: 1,
        occurredAt: new Date(occurredAt),
        attributionQuality: 'exact',
        sourceReceipt: {
          eventId: 'event-review-created',
          consumerName: 'metric.public-reputation',
        },
      },
    ])
  })

  it('classifies replay and expired content without duplicating a reading', async () => {
    const register = (rating: number | null, status: 'duplicate' | 'recorded') => {
      const recordMetric = vi.fn(async () =>
        status === 'duplicate'
          ? ({ status: 'duplicate', existingReadingId: 'reading-1' } as const)
          : ({ status: 'recorded', reading: {} as never } as const),
      )
      registerPublicReputationMetricConsumers(consumerRegistry, {
        recordMetric,
        reviewRatingLookup: { getEligibleRatingById: vi.fn(async () => rating) },
        db: receiptDb,
      })
      return { registration: mocks.registerConsumer.mock.calls.at(-1)![0], recordMetric }
    }

    const duplicate = register(5, 'duplicate')
    await expect(duplicate.registration.handler(envelope())).resolves.toEqual({
      status: 'duplicate',
    })

    const expired = register(null, 'recorded')
    await expect(expired.registration.handler(envelope())).resolves.toEqual({
      status: 'obsolete',
    })
    expect(expired.recordMetric).not.toHaveBeenCalled()
    expect(receiptValues).toHaveBeenCalledWith({
      eventId: 'event-review-created',
      consumerName: 'metric.public-reputation',
      status: 'obsolete',
    })
  })

  it('fails closed on envelope attribution drift or an invalid source time', async () => {
    registerPublicReputationMetricConsumers(consumerRegistry, {
      recordMetric: vi.fn(),
      reviewRatingLookup: { getEligibleRatingById: vi.fn(async () => 4) },
      db: receiptDb,
    })
    const registration = mocks.registerConsumer.mock.calls[0]![0]

    await expect(
      registration.handler(envelope({ organizationId: 'other-org' })),
    ).rejects.toThrow('envelope attribution')
    await expect(
      registration.handler(envelope({ sourceAggregateId: 'another-review' })),
    ).rejects.toThrow('source authority')
    await expect(
      registration.handler(
        envelope({ payload: { ...payload, occurredAt: 'not-a-time' } }),
      ),
    ).rejects.toThrow('occurredAt')
  })

  it('propagates transient persistence failures and explicit rejections', async () => {
    const recordMetric = vi
      .fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({
        status: 'rejected',
        reason: 'definition_not_approved',
        sourceEventId: 'event-review-created',
      })
    registerPublicReputationMetricConsumers(consumerRegistry, {
      recordMetric,
      reviewRatingLookup: { getEligibleRatingById: vi.fn(async () => 4) },
      db: receiptDb,
    })
    const registration = mocks.registerConsumer.mock.calls[0]![0]

    await expect(registration.handler(envelope())).rejects.toThrow('database unavailable')
    await expect(registration.handler(envelope())).rejects.toThrow(
      'Public Reputation metric rejected',
    )
  })
})
