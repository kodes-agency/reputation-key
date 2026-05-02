import type { EventBus } from '#/shared/events/event-bus'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import { reviewLinkClicked } from '../../domain/events'

export type TrackReviewLinkClickDeps = Readonly<{
  events: EventBus
  clock: () => Date
}>

export type TrackReviewLinkClickInput = Readonly<{
  linkId: string
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
}>

export const trackReviewLinkClick =
  (deps: TrackReviewLinkClickDeps) =>
  async (input: TrackReviewLinkClickInput): Promise<void> => {
    try {
      const now = deps.clock()
      deps.events.emit(
        reviewLinkClicked({
          linkId: input.linkId,
          organizationId: input.organizationId,
          portalId: input.portalId,
          propertyId: input.propertyId,
          occurredAt: now,
        }),
      )
    } catch {
      // Silent failure — click tracking is analytics
    }
  }

export type TrackReviewLinkClick = ReturnType<typeof trackReviewLinkClick>
