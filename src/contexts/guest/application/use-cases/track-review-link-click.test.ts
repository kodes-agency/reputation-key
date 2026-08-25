import { trackReviewLinkClick } from './track-review-link-click'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { organizationId, portalId, propertyId, portalLinkId } from '#/shared/domain/ids'
import type { GuestObservationStore } from '../ports/guest-observation-store.port'

describe('trackReviewLinkClick', () => {
  it('commits the durable observation before its fast-path event', async () => {
    const events = createCapturingEventBus()
    const store: GuestObservationStore = {
      commitScan: async () => 'applied',
      commitReviewLinkClick: async (fact) => {
        await events.emit(fact)
        return 'applied'
      },
    }
    const useCase = trackReviewLinkClick({
      observationStore: store,
      clock: () => new Date('2026-05-01T12:00:00Z'),
      logger: createMockLogger(),
    })

    await useCase({
      linkId: portalLinkId('link-123'),
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
    })

    expect(events.capturedByTag('guest.review_link.clicked')).toHaveLength(1)
  })

  it('keeps approved navigation available when observation persistence fails', async () => {
    const store: GuestObservationStore = {
      commitScan: async () => 'applied',
      commitReviewLinkClick: async () => {
        throw new Error('observation unavailable')
      },
    }
    const useCase = trackReviewLinkClick({
      observationStore: store,
      clock: () => new Date('2026-05-01T12:00:00Z'),
      logger: createMockLogger(),
    })

    await expect(
      useCase({
        linkId: portalLinkId('link-123'),
        organizationId: organizationId('org-1'),
        portalId: portalId('portal-1'),
        propertyId: propertyId('prop-1'),
      }),
    ).resolves.toBeUndefined()
  })
})
