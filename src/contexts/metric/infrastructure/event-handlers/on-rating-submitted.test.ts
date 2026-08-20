import { describe, it, expect, beforeEach } from 'vitest'
import { onRatingSubmitted } from './on-rating-submitted'
import type { RecordPortalMetricDeps as OnRatingSubmittedDeps } from './record-portal-metric'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import {
  organizationId,
  portalId,
  propertyId,
  ratingId,
  portalGroupId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-05-20T12:00:00Z')

const createFakeDeps = (
  overrides: Partial<Pick<OnRatingSubmittedDeps, 'findGroupForPortal'>> = {},
): OnRatingSubmittedDeps & {
  readings: RecordMetricInput[]
} => {
  const readings: RecordMetricInput[] = []
  return {
    readings,
    recordMetric: async (input) => {
      readings.push({ ...input })
      return input
    },
    findGroupForPortal: overrides.findGroupForPortal ?? (async () => null),
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
})

describe('onRatingSubmitted', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('records a governed portal.rating reading with unresolved portal-group attribution', async () => {
    const handler = onRatingSubmitted(deps)
    await handler(ratingEvent())

    expect(deps.readings).toHaveLength(1)
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
    const handler = onRatingSubmitted(groupDeps)
    await handler(ratingEvent())

    expect(groupDeps.readings).toHaveLength(1)
    expect(groupDeps.readings[0]!.portalGroupId).toBeNull()
  })

  it('does not throw when recordMetric fails', async () => {
    const failingDeps: OnRatingSubmittedDeps = {
      recordMetric: async () => {
        throw new Error('DB unavailable')
      },
      findGroupForPortal: async () => null,
    }
    const handler = onRatingSubmitted(failingDeps)

    await expect(handler(ratingEvent())).resolves.toBeUndefined()
  })
})
