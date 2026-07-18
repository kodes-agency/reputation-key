// Shared SET-clause builder for reply guarded updates (BQC-3.3).
//
// Used by ReplyRepository.conditionalUpdate and the atomic ReplyCommandStore
// so both enforce the identical field mapping inside their guarded writes —
// the TOCTOU guard semantics must never drift between the two.

import type { ConditionalReplyUpdate } from '../application/ports/reply.repository'

export function buildReplySetClause(
  updates: ConditionalReplyUpdate,
  updatedAt: Date,
): Record<string, unknown> {
  const setClause: Record<string, unknown> = { updatedAt }
  if (updates.status !== undefined) setClause.status = updates.status
  if (updates.text !== undefined) setClause.text = updates.text
  if (updates.submittedAt !== undefined) setClause.submittedAt = updates.submittedAt
  if (updates.approvedBy !== undefined) setClause.approvedBy = updates.approvedBy
  if (updates.approvedAt !== undefined) setClause.approvedAt = updates.approvedAt
  if (updates.rejectedBy !== undefined) setClause.rejectedBy = updates.rejectedBy
  if (updates.rejectionReason !== undefined)
    setClause.rejectionReason = updates.rejectionReason
  if (updates.publishedAt !== undefined) setClause.publishedAt = updates.publishedAt
  return setClause
}
