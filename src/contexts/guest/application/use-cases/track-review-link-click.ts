import type { EventBus } from '#/shared/events/event-bus'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  PortalLinkId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { guestReviewLinkClicked } from '../../domain/events'
import { emitAndRecord } from '#/shared/outbox/emit-and-record'
import type { OutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'

export type TrackReviewLinkClickDeps = Readonly<{
  events: EventBus
  clock: () => Date
  logger: LoggerPort
  outboxRepo?: OutboxRepository
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
      await emitAndRecord(
        deps.events,
        deps.outboxRepo,
        guestReviewLinkClicked({
          linkId: input.linkId,
          organizationId: input.organizationId,
          portalId: input.portalId,
          propertyId: input.propertyId,
          occurredAt: now,
        }),
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
