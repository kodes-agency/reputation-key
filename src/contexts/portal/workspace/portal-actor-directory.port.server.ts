// Portal context — bounded actor display-name resolution for History.
//
// The ledger names who published, restored or turned off a code. This resolves
// a bounded batch of user ids to display names inside one Organization and
// returns nothing else (no email, role or membership state). An id outside the
// Organization, or with no usable name, is simply absent: the caller renders a
// neutral placeholder and never the raw identifier.

import type { OrganizationId, UserId } from '#/shared/domain/ids'

/** History pages are capped at 50 entries, so a page never names more than 50 people. */
export const MAX_PORTAL_ACTOR_DIRECTORY_BATCH = 100

export type PortalActorDirectory = Readonly<{
  resolveDisplayNames(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlyMap<UserId, string>>
}>
