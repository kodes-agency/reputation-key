// Review context — who a reply's outcome is news to.
//
// The decision and publication facts (approved, rejected, published, publish
// failed, publication cancelled) carry an `authorId`, and Feed addresses the
// "your reply …" notices to it. That used to be the reply's creator. A draft
// is often started by one manager and finished by another — the item is handed
// on, the text rewritten or replaced by an accepted AI suggestion, then
// submitted — and the creator's notices went to someone who had moved on,
// while the manager waiting on the decision heard nothing.

import { userId, type UserId } from '#/shared/domain/ids'
import type { Reply } from './types'

/**
 * Whoever last put the reply up for approval; its creator for a reply
 * submitted before the submitter was recorded, and null when neither is known.
 */
export const replyAuthor = (
  reply: Pick<Reply, 'createdBy' | 'submittedBy'>,
): UserId | null => reply.submittedBy ?? reply.createdBy

/** The same rule over the stored columns, for writes that never map a Reply. */
export const rowReplyAuthor = (
  row: Readonly<{ createdBy: string | null; submittedBy: string | null }>,
): UserId | null => {
  const author = row.submittedBy ?? row.createdBy
  return author === null ? null : userId(author)
}
