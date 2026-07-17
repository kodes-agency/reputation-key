// Metric context — review rating lookup port (BQC-1.2).
// The rating metric consumes the rating at consume time via this authorized
// read — durable events no longer carry rating (identifier-only, ADR 0030).

import type { OrganizationId, ReviewId } from '#/shared/domain/ids'

export type ReviewRatingLookupPort = Readonly<{
  /** Rating when the review's content is eligible; null when expired/missing. */
  getEligibleRatingById(id: ReviewId, orgId: OrganizationId): Promise<number | null>
}>
