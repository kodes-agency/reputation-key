// Feed notification surface — who may approve a reply, right now.
//
// Responsibility and permission are separate authorities: a Property's
// responsible managers are the people who own its work, but only the ones who
// hold `reply.manage` can act on an approval request. Identity owns that
// decision; Feed asks it by name and never reads roles or grants itself.

import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'

export type ReplyApprovalAuthorityPort = Readonly<{
  /** Whether this member may approve or reject replies for the Property now. */
  canApproveReplies(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    userId: UserId,
  ): Promise<boolean>
}>
