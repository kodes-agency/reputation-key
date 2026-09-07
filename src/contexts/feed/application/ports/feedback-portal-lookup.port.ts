import type { FeedbackId, OrganizationId, PortalId } from '#/shared/domain/ids'

/** Guest-owned, content-free source attribution used for feedback routing. */
export type FeedbackPortalLookupPort = Readonly<{
  findPortalId(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<PortalId | null>
}>
