import type { GuestObservationStore } from '../ports/guest-observation-store.port'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  PortalLinkId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { guestReviewLinkClicked } from '../../domain/events'

export type TrackReviewLinkClickDeps = Readonly<{
  observationStore: GuestObservationStore
  clock: () => Date
  logger: LoggerPort
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
    } catch (e) {
      // Silent failure — click tracking is analytics
      deps.logger.warn(
        { err: e, linkId: input.linkId },
        'Review link click tracking failed — suppressed',
      )
    }
  }

export type TrackReviewLinkClick = ReturnType<typeof trackReviewLinkClick>
