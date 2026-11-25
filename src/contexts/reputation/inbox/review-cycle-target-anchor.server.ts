import type {
  ReviewCurrentResponseTargetPermit,
  ReviewInboxProjectionRevisionPermit,
} from '#/contexts/reputation/reviews/response-target-authority.port.server'

/**
 * Inbox owns the clock for a new operational Handling Cycle, while Review owns
 * the immutable Google publication/revision provenance. Keeping those facts in
 * a discriminated anchor prevents a caller from rewriting Review's attested
 * start instant when a manager or exact provider observation opens new work.
 */
export type ReviewCycleTargetAnchor = Readonly<{
  reviewAuthority: ReviewCurrentResponseTargetPermit | ReviewInboxProjectionRevisionPermit
  targetStart:
    | Readonly<{ basis: 'review_provenance' }>
    | Readonly<{ basis: 'operational_reopen'; at: Date }>
}>
