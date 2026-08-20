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
  if (updates.aiGenerated !== undefined) {
    setClause.aiGenerated = updates.aiGenerated
    if (!updates.aiGenerated) {
      setClause.authorship = 'human'
      setClause.originOperationId = null
      setClause.originSourceEpoch = null
      setClause.originSourceRevision = null
      setClause.originBaseReplyStateRevision = null
      setClause.originReplyDraftingEpoch = null
      setClause.originPropertyProfileVersion = null
      setClause.originAiProfileVersion = null
      setClause.originReplyTemplateId = null
      setClause.originReplyTemplateCatalogueVersion = null
      setClause.originReplyTemplateCatalogueDigest = null
      setClause.originConcreteLanguageTag = null
      setClause.originTemplateGroup = null
      setClause.aiDraftExpiresAt = null
    }
  }
  if (updates.submittedAt !== undefined) setClause.submittedAt = updates.submittedAt
  if (updates.approvedBy !== undefined) setClause.approvedBy = updates.approvedBy
  if (updates.approvedAt !== undefined) setClause.approvedAt = updates.approvedAt
  if (updates.rejectedBy !== undefined) setClause.rejectedBy = updates.rejectedBy
  if (updates.rejectionReason !== undefined)
    setClause.rejectionReason = updates.rejectionReason
  if (updates.publishedAt !== undefined) setClause.publishedAt = updates.publishedAt
  // BQC-3.8: publication state machine fields.
  if (updates.publicationState !== undefined)
    setClause.publicationState = updates.publicationState
  if (updates.publicationAttempts !== undefined)
    setClause.publicationAttempts = updates.publicationAttempts
  if (updates.publicationLastErrorClass !== undefined)
    setClause.publicationLastErrorClass = updates.publicationLastErrorClass
  if (updates.reconcileDueAt !== undefined)
    setClause.reconcileDueAt = updates.reconcileDueAt
  return setClause
}
