// Review context — mapping a review stored outside a snapshot run to its
// provider subject.
//
// A full listing maps every review it sees, and only a mapped review can be
// removed when Google deletes it. A head check or a push that stores a review
// records the sighting here, so a review no listing has seen yet is removed
// once deletion is confirmed rather than kept until its content expires.

import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { ReviewProviderSubjectCandidates } from './review-provider-observation-writer.port'

export type ReviewProviderSubjectSighting = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  reviewId: ReviewId
  /** The source revision the write stored. */
  sourceRevision: number
  /** The candidates the write was made with; the first is under the active key. */
  subjects: ReviewProviderSubjectCandidates
}>

export type ReviewProviderSubjectSightingOutcome =
  /** No mapping existed: one is linked now. */
  | 'linked'
  /** A mapping of this review exists: it stays, with its revision kept current. */
  | 'already_mapped'
  /** The locator or the review is mapped to another resource: left as it is. */
  | 'collision'
  /** A key rotation is staged: nothing is written; the next listing maps it. */
  | 'key_rotating'
  /** The write failed and was logged; the next listing maps it. */
  | 'unavailable'

export type ReviewProviderSubjectSightings = Readonly<{
  /** Inserts a missing mapping or keeps one's revision current. Never throws. */
  record(
    sighting: ReviewProviderSubjectSighting,
  ): Promise<ReviewProviderSubjectSightingOutcome>
}>
