import { trackReviewLinkClick } from './track-review-link-click'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { organizationId, portalId, propertyId, portalLinkId } from '#/shared/domain/ids'
import type { GuestObservationStore } from '../ports/guest-observation-store.port'

const SESSION_EXPIRES_AT = new Date('2026-05-02T12:00:00Z')

describe('trackReviewLinkClick', () => {
  it('commits the durable destination fact through the observation store', async () => {
    const outbox = createRecordedOutbox()
    const store: GuestObservationStore = {
      commitQualifiedScan: async () => 'applied',
      retractQualifiedScan: async () => 'applied',
      commitScan: async () => 'applied',
      commitReviewLinkClick: async (_action, fact) => {
        await outbox.record(fact)
        return 'applied'
      },
    }
    const useCase = trackReviewLinkClick({
      observationStore: store,
      clock: () => new Date('2026-05-01T12:00:00Z'),
      reportObservationLoss: vi.fn(async () => 'recorded' as const),
    })

    await useCase({
      linkId: portalLinkId('link-123'),
      sessionId: '00000000-0000-4000-8000-000000000100',
      sessionExpiresAt: SESSION_EXPIRES_AT,
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
    })

    expect(outbox.byTag('guest.review_link.clicked')).toMatchObject([
      { destinationKind: 'secondary_link' },
    ])
  })

  it('preserves Google selections as a distinct durable destination fact', async () => {
    const outbox = createRecordedOutbox()
    const store: GuestObservationStore = {
      commitQualifiedScan: async () => 'applied',
      retractQualifiedScan: async () => 'applied',
      commitScan: async () => 'applied',
      commitReviewLinkClick: async (_action, fact) => {
        await outbox.record(fact)
        return 'applied'
      },
    }
    const useCase = trackReviewLinkClick({
      observationStore: store,
      clock: () => new Date('2026-05-01T12:00:00Z'),
      reportObservationLoss: vi.fn(async () => 'recorded' as const),
    })

    await useCase({
      linkId: portalLinkId('google-review'),
      destinationKind: 'google_review',
      sessionId: '00000000-0000-4000-8000-000000000101',
      sessionExpiresAt: SESSION_EXPIRES_AT,
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
    })

    expect(outbox.byTag('guest.review_link.clicked')).toMatchObject([
      { destinationKind: 'google_review' },
    ])
  })

  it('keeps approved navigation available when observation persistence fails', async () => {
    const store: GuestObservationStore = {
      commitQualifiedScan: async () => 'applied',
      retractQualifiedScan: async () => 'applied',
      commitScan: async () => 'applied',
      commitReviewLinkClick: async () => {
        throw new Error('observation unavailable')
      },
    }
    const reportObservationLoss = vi.fn(async () => 'recorded' as const)
    const useCase = trackReviewLinkClick({
      observationStore: store,
      clock: () => new Date('2026-05-01T12:00:00Z'),
      reportObservationLoss,
    })

    await expect(
      useCase({
        linkId: portalLinkId('link-123'),
        sessionId: '00000000-0000-4000-8000-000000000102',
        sessionExpiresAt: SESSION_EXPIRES_AT,
        organizationId: organizationId('org-1'),
        portalId: portalId('portal-1'),
        propertyId: propertyId('prop-1'),
      }),
    ).resolves.toBeUndefined()
    expect(reportObservationLoss).toHaveBeenCalledOnce()
    expect(reportObservationLoss).toHaveBeenCalledWith('review_link')
  })
})
