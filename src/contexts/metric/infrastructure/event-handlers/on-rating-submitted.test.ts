import { describe, it, expect, beforeEach } from 'vitest'
import { onRatingSubmitted } from './on-rating-submitted'
import type { RecordPortalMetricDeps as OnRatingSubmittedDeps } from './record-portal-metric'
import type {
  RecordMetricEntryInput,
  RecordMetricsInput,
} from '../../application/use-cases/record-metric'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  organizationId,
  portalId,
  propertyId,
  ratingId,
  portalGroupId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-05-20T12:00:00Z')
const STAFF_ATTRIBUTION = {
  staffParticipantId: '10000000-0000-4000-8000-000000000001',
  staffParticipationId: '10000000-0000-4000-8000-000000000002',
  portalResponsibilityId: '10000000-0000-4000-8000-000000000003',
  effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
  effectiveTo: null,
} as const

const createFakeDeps = (
  overrides: Partial<Pick<OnRatingSubmittedDeps, 'findGroupForPortal'>> = {},
): OnRatingSubmittedDeps & {
  readings: RecordMetricEntryInput[]
  receipts: Array<{
    eventId: string
    consumerName: string
    status: 'applied'
  }>
  deliveryResults: Array<readonly { status: string }[]>
} => {
  const readings: RecordMetricEntryInput[] = []
  const receipts: Array<{
    eventId: string
    consumerName: string
    status: 'applied'
  }> = []
  const deliveryResults: Array<readonly { status: string }[]> = []
  const settledReceipts = new Set<string>()
  return {
    readings,
    receipts,
    deliveryResults,
    recordMetrics: async (input: RecordMetricsInput) => {
      const receiptKey = input.sourceReceipt
        ? `${input.sourceReceipt.eventId}:${input.sourceReceipt.consumerName}`
        : null
      const duplicate = receiptKey !== null && settledReceipts.has(receiptKey)
      if (!duplicate) {
        readings.push(...input.readings)
        if (receiptKey && input.sourceReceipt) {
          settledReceipts.add(receiptKey)
          receipts.push({ ...input.sourceReceipt, status: 'applied' })
        }
      }
      const results = input.readings.map((reading, index) =>
        duplicate
          ? {
              status: 'duplicate' as const,
              existingReadingId: `${reading.definitionVersionId}:${index}`,
            }
          : { status: 'recorded' as const, reading: {} as never },
      )
      deliveryResults.push(results)
      return results
    },
    findGroupForPortal: overrides.findGroupForPortal ?? (async () => null),
    logger: createMockLogger(),
  }
}

const ratingEvent = () => ({
  _tag: 'guest.rating.submitted' as const,
  eventId: 'test-event-id',
  correlationId: null,
  ratingId: ratingId('rating-1'),
  organizationId: organizationId('org-1'),
  portalId: portalId('portal-1'),
  propertyId: propertyId('prop-1'),
  value: 4,
  occurredAt: FIXED_TIME,
  staffAttribution: STAFF_ATTRIBUTION,
})

describe('onRatingSubmitted', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('settles one receipt atomically with all three rating readings', async () => {
    const handler = onRatingSubmitted(deps)
    await handler(ratingEvent())
    await handler(ratingEvent())

    expect(deps.readings).toHaveLength(3)
    expect(deps.receipts).toEqual([
      {
        eventId: 'test-event-id',
        consumerName: 'metric.guest-analytics',
        status: 'applied',
      },
    ])
    expect(
      deps.deliveryResults.map((results) => results.map(({ status }) => status)),
    ).toEqual([
      ['recorded', 'recorded', 'recorded'],
      ['duplicate', 'duplicate', 'duplicate'],
    ])
    expect(deps.readings[0]).toEqual({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      portalGroupId: null,
      definitionVersionId: '11111111-1111-4111-8111-111111111202',
      sourceEventId: 'test-event-id',
      sourcePolicy: 'first_party_guest_private',
      scope: 'portal',
      value: 4,
      sampleCount: 1,
      attributionQuality: 'exact',
      occurredAt: FIXED_TIME,
      staffAttribution: STAFF_ATTRIBUTION,
    })
    expect(deps.readings[1]).toMatchObject({
      definitionVersionId: '11111111-1111-4111-8111-111111111302',
      sourcePolicy: 'first_party_guest_gateway_metric',
      value: 1,
      sampleCount: 1,
    })
    expect(deps.readings[2]).toMatchObject({
      definitionVersionId: '11111111-1111-4111-8111-111111111303',
      sourcePolicy: 'first_party_guest_gateway_metric',
      value: 4,
      sampleCount: 1,
    })
  })

  it('resolves portalGroupId from membership for downstream attribution', async () => {
    const groupId = portalGroupId('group-42')
    const calls: Array<{ orgId: unknown; portalId: unknown }> = []
    const groupDeps = createFakeDeps({
      findGroupForPortal: async (orgId, pid) => {
        calls.push({ orgId, portalId: pid })
        return { portalGroupId: groupId }
      },
    })
    const handler = onRatingSubmitted(groupDeps)
    await handler(ratingEvent())

    expect(groupDeps.readings).toHaveLength(3)
    expect(groupDeps.readings.every((reading) => reading.portalGroupId === groupId)).toBe(
      true,
    )
    expect(calls).toEqual([
      { orgId: organizationId('org-1'), portalId: portalId('portal-1') },
    ])
  })

  it('still records the metric (groupId null) when group resolution throws', async () => {
    const groupDeps = createFakeDeps({
      findGroupForPortal: async () => {
        throw new Error('portal group lookup failed')
      },
    })
    const handler = onRatingSubmitted(groupDeps)
    await handler(ratingEvent())

    expect(groupDeps.readings).toHaveLength(3)
    expect(groupDeps.readings.every((reading) => reading.portalGroupId === null)).toBe(
      true,
    )
  })

  it('does not throw when recordMetrics fails', async () => {
    const failingDeps: OnRatingSubmittedDeps = {
      recordMetrics: async () => {
        throw new Error('DB unavailable')
      },
      findGroupForPortal: async () => null,
      logger: createMockLogger(),
    }
    const handler = onRatingSubmitted(failingDeps)

    await expect(handler(ratingEvent())).resolves.toBeUndefined()
  })
})
