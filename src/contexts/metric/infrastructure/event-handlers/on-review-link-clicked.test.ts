import { describe, it, expect, beforeEach } from 'vitest'
import { onReviewLinkClicked } from './on-review-link-clicked'
import type { RecordPortalMetricDeps as OnReviewLinkClickedDeps } from './record-portal-metric'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  organizationId,
  portalId,
  propertyId,
  portalLinkId,
  portalGroupId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-05-20T12:00:00Z')

const createFakeDeps = (
  overrides: Partial<Pick<OnReviewLinkClickedDeps, 'findGroupForPortal'>> = {},
): OnReviewLinkClickedDeps & {
  readings: RecordMetricInput[]
} => {
  const readings: RecordMetricInput[] = []
  return {
    readings,
    recordMetric: async (input) => {
      readings.push({ ...input })
      return { status: 'duplicate', existingReadingId: input.sourceEventId }
    },
    findGroupForPortal: overrides.findGroupForPortal ?? (async () => null),
    logger: createMockLogger(),
  }
}

const clickEvent = () => ({
  _tag: 'guest.review_link.clicked' as const,
  eventId: 'test-event-id',
  correlationId: null,
  linkId: portalLinkId('link-1'),
  destinationKind: 'secondary_link' as const,
  organizationId: organizationId('org-1'),
  portalId: portalId('portal-1'),
  propertyId: propertyId('prop-1'),
  occurredAt: FIXED_TIME,
})

describe('onReviewLinkClicked', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('records a governed portal.review_link_click reading with unresolved portal-group attribution', async () => {
    const handler = onReviewLinkClicked(deps)
    await handler(clickEvent())

    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      portalGroupId: null,
      definitionVersionId: '11111111-1111-4111-8111-111111111204',
      sourceEventId: 'test-event-id',
      sourcePolicy: 'review_solicitation_analytics_only',
      scope: 'portal',
      value: 1,
      sampleCount: 1,
      attributionQuality: 'exact',
      staffAttribution: null,
      destinationKind: 'secondary_link',
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
    const handler = onReviewLinkClicked(groupDeps)
    await handler(clickEvent())

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
    const handler = onReviewLinkClicked(groupDeps)
    await handler(clickEvent())

    expect(groupDeps.readings).toHaveLength(1)
    expect(groupDeps.readings[0]!.portalGroupId).toBeNull()
  })

  it('does not throw when recordMetric fails', async () => {
    const failingDeps: OnReviewLinkClickedDeps = {
      recordMetric: async () => {
        throw new Error('DB unavailable')
      },
      findGroupForPortal: async () => null,
      logger: createMockLogger(),
    }
    const handler = onReviewLinkClicked(failingDeps)

    await expect(handler(clickEvent())).resolves.toBeUndefined()
  })
})
