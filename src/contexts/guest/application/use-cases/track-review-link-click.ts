import type { EventBus } from '#/shared/events/event-bus'
import type { OrganizationId, PortalId, PropertyId, PortalLinkId } from '#/shared/domain/ids'
import { reviewLinkClicked } from '../../domain/events'
import { getLogger } from '#/shared/observability/logger'

export type TrackReviewLinkClickDeps = Readonly<{
  events: EventBus
  clock: () => Date
}>

export type TrackReviewLinkClickInput = Readonly<{
  linkId: PortalLinkId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
}>

export const trackReviewLinkClick =
  (deps: TrackReviewLinkClickDeps) =>
  async (input: TrackReviewLinkClickInput): Promise<void> => {
    try {
      const now = deps.clock()
      await deps.events.emit(
        reviewLinkClicked({
          linkId: input.linkId,
          organizationId: input.organizationId,
          portalId: input.portalId,
          propertyId: input.propertyId,
          occurredAt: now,
        }),
      )
    } catch (e) {
      // Silent failure — click tracking is analytics
      getLogger().warn({ err: e, linkId: input.linkId }, 'Review link click tracking failed — suppressed')
    }
  }

export type TrackReviewLinkClick = ReturnType<typeof trackReviewLinkClick>
