import type { GuestObservationStore } from '../ports/guest-observation-store.port'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  PortalLinkId,
} from '#/shared/domain/ids'
import { guestReviewLinkClicked } from '../../domain/events'
import type { GuestObservationLossReporter } from '../ports/guest-observation-loss-monitor.port'

export type TrackReviewLinkClickDeps = Readonly<{
  observationStore: GuestObservationStore
  clock: () => Date
  reportObservationLoss: GuestObservationLossReporter
}>

export type TrackReviewLinkClickInput = Readonly<{
  linkId: PortalLinkId
  destinationKind?: 'google_review' | 'secondary_link'
  sessionId: string
  sessionExpiresAt: Date
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
}>

export const trackReviewLinkClick =
  (deps: TrackReviewLinkClickDeps) =>
  async (input: TrackReviewLinkClickInput): Promise<void> => {
    try {
      const now = deps.clock()
      const destinationKind = input.destinationKind ?? 'secondary_link'
      const fact = guestReviewLinkClicked({
        linkId: input.linkId,
        destinationKind,
        organizationId: input.organizationId,
        portalId: input.portalId,
        propertyId: input.propertyId,
        occurredAt: now,
      })
      await deps.observationStore.commitReviewLinkClick(
        {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          portalId: input.portalId,
          sessionId: input.sessionId,
          destinationId: input.linkId,
          destinationKind,
          occurredAt: now,
          expiresAt: input.sessionExpiresAt,
        },
        fact,
      )
    } catch {
      // The approved URL remains available; only the content-free loss class
      // is retained, never the destination/session/tenant scope.
      try {
        await deps.reportObservationLoss('review_link')
      } catch {
        // Monitoring degradation must not widen the navigation failure.
      }
    }
  }

export type TrackReviewLinkClick = ReturnType<typeof trackReviewLinkClick>
