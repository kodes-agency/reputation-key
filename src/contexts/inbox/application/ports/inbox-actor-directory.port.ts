// Inbox context — bounded actor display-name resolution (IBX-01-T6).
//
// Manager history and notes are unreadable when every author renders as an
// eight-character id fragment. This port resolves a BOUNDED batch of user ids
// to display names inside one Organization, and it deliberately returns nothing
// else: no email, no avatar, no role, no membership state. An id the caller has
// no business seeing simply does not come back, and the caller renders an
// opaque placeholder rather than leaking the raw identifier.

import type { OrganizationId, UserId } from '#/shared/domain/ids'

/**
 * The largest batch a single request may resolve. Callers are already bounded
 * (history and notes both read under an explicit LIMIT), so exceeding this is a
 * caller bug, not a user input — the adapter fails loudly rather than silently
 * dropping names and rendering half the thread as "Unknown user".
 */
export const MAX_INBOX_ACTOR_DIRECTORY_BATCH = 500

export type InboxActorDirectory = Readonly<{
  /**
   * One batched lookup per request. Ids outside the Organization, and users
   * with no usable display name, are absent from the result — absence is the
   * only "unknown" signal, so no caller has to interpret an empty string.
   */
  resolveDisplayNames(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlyMap<UserId, string>>
}>
