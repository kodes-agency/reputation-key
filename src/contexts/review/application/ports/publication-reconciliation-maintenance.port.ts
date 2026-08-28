import type { OrganizationId, ReplyId } from '#/shared/domain/ids'

/**
 * Content-free operator projection for one Reply whose ambiguous provider
 * outcome is due for a read-only reconciliation. Reply text, author identity,
 * Review identity, and provider content are deliberately outside this
 * contract.
 */
export type AmbiguousPublicationReconciliationCandidate = Readonly<{
  replyId: ReplyId
  organizationId: OrganizationId
  publicationState: 'ambiguous'
  reconcileDueAt: Date
}>

export type AmbiguousPublicationReconciliationCursor = Readonly<{
  reconcileDueAt: Date
  replyId: ReplyId
}>

export type FindAmbiguousPublicationReconciliationCandidates = (
  input: Readonly<{
    dueThrough: Date
    after: AmbiguousPublicationReconciliationCursor | null
    limit: number
  }>,
) => Promise<ReadonlyArray<AmbiguousPublicationReconciliationCandidate>>

/** Review-owned query boundary used by bounded operator reconciliation. */
export type PublicationReconciliationCandidateQuery = Readonly<{
  findAmbiguousCandidates: FindAmbiguousPublicationReconciliationCandidates
}>
