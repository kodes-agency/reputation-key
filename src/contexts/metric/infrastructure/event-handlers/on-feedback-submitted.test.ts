import { describe, it, expect, beforeEach } from 'vitest'
import { onFeedbackSubmitted } from './on-feedback-submitted'
import type { RecordPortalMetricDeps as OnFeedbackSubmittedDeps } from './record-portal-metric'
import type { RecordMetricEntryInput } from '../../application/use-cases/record-metric'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  organizationId,
  portalId,
  propertyId,
  feedbackId,
  ratingId,
  portalGroupId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-05-20T12:00:00Z')

const createFakeDeps = (
  overrides: Partial<Pick<OnFeedbackSubmittedDeps, 'findGroupForPortal'>> = {},
): OnFeedbackSubmittedDeps & {
  readings: RecordMetricEntryInput[]
} => {
  const readings: RecordMetricEntryInput[] = []
  return {
    readings,
    recordMetrics: async (input) => {
      readings.push(...input.readings)
      return input.readings.map((reading) => ({
        status: 'duplicate' as const,
        existingReadingId: reading.sourceEventId,
      }))
    },
    findGroupForPortal: overrides.findGroupForPortal ?? (async () => null),
    logger: createMockLogger(),
  }
}

const feedbackEvent = () => ({
  _tag: 'guest.feedback.submitted' as const,
  eventId: 'test-event-id',
  correlationId: null,
  feedbackId: feedbackId('fb-1'),
  organizationId: organizationId('org-1'),
  portalId: portalId('portal-1'),
  propertyId: propertyId('prop-1'),
  ratingId: ratingId('rating-1'),
  occurredAt: FIXED_TIME,
})

describe('onFeedbackSubmitted', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('records a governed portal.feedback reading with unresolved portal-group attribution', async () => {
    const handler = onFeedbackSubmitted(deps)
    await handler(feedbackEvent())

    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      portalGroupId: null,
      definitionVersionId: '11111111-1111-4111-8111-111111111203',
      sourceEventId: 'test-event-id',
      sourcePolicy: 'first_party_guest_private',
      scope: 'portal',
      value: 1,
      sampleCount: 1,
      attributionQuality: 'exact',
      staffAttribution: null,
      occurredAt: FIXED_TIME,
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
    const handler = onFeedbackSubmitted(groupDeps)
    await handler(feedbackEvent())

    expect(groupDeps.readings).toHaveLength(1)
    expect(groupDeps.readings[0]!.portalGroupId).toEqual(groupId)
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
    const handler = onFeedbackSubmitted(groupDeps)
    await handler(feedbackEvent())

    expect(groupDeps.readings).toHaveLength(1)
    expect(groupDeps.readings[0]!.portalGroupId).toBeNull()
  })

  it('does not throw when recordMetrics fails', async () => {
    const failingDeps: OnFeedbackSubmittedDeps = {
      recordMetrics: async () => {
        throw new Error('DB unavailable')
      },
      findGroupForPortal: async () => null,
      logger: createMockLogger(),
    }
    const handler = onFeedbackSubmitted(failingDeps)

    await expect(handler(feedbackEvent())).resolves.toBeUndefined()
  })
})
