// Review context — Google Review API facade port
// Per architecture: "Facade port — takes connectionId, returns typed reviews.
// Pagination handled internally. Review context never sees access tokens."

import type { OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'
import type { GoogleReview } from '../../domain/types'

export type GoogleReviewApiPort = Readonly<{
  fetchReviews: (
    organizationId: OrganizationId,
    connectionId: GoogleConnectionId,
    locationName: string,
  ) => Promise<ReadonlyArray<GoogleReview>>
  replyToReview: (
    organizationId: OrganizationId,
    connectionId: GoogleConnectionId,
    reviewName: string,
    text: string,
  ) => Promise<void>
}>
