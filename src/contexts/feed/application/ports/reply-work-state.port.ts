// Feed notification surface — where a review's reply stands, right now.
//
// "Approve a reply" and "Reply not published" ask for work on the reply, and
// Review owns the reply. Feed asks for its status by name, content-free, so it
// can tell whether that work is still waiting before it writes or mails a
// notice (ADR 0046, amended 2026-09-24).

import type { OrganizationId, ReviewId } from '#/shared/domain/ids'

export type ReplyWorkStatus =
  'draft' | 'pending_approval' | 'approved' | 'published' | 'rejected' | 'publish_failed'

export type ReplyWorkStateLookupPort = Readonly<{
  /** The status of the review's RepKey-authored reply; null when it has none. */
  findReplyStatus(
    reviewId: ReviewId,
    organizationId: OrganizationId,
  ): Promise<ReplyWorkStatus | null>
}>
