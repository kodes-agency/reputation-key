import { trackReviewLinkClick } from './track-review-link-click'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'

describe('trackReviewLinkClick', () => {
  it('emits review-link.clicked event', async () => {
    const bus = createCapturingEventBus()
    const useCase = trackReviewLinkClick({
      events: bus,
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    await useCase({
      linkId: 'link-123',
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
    })

    expect(bus.capturedEvents).toHaveLength(1)
    expect(bus.capturedEvents[0]._tag).toBe('review-link.clicked')
  })

  it('silently fails when event emit throws', async () => {
    const throwingBus = {
      emit: () => {
        throw new Error('event bus failure')
      },
      on: () => {},
      off: () => {},
    }
    const useCase = trackReviewLinkClick({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events: throwingBus as any,
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    await expect(
      useCase({
        linkId: 'link-123',
        organizationId: organizationId('org-1'),
        portalId: portalId('portal-1'),
        propertyId: propertyId('prop-1'),
      }),
    ).resolves.toBeUndefined()
  })
})
