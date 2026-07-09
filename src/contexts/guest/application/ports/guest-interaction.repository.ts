// Guest context — repository port for guest write operations.
// Single repo because all guest interactions are writes.
// recordScan/insertRating/insertFeedback take domain objects (which carry organizationId).
// hasRated takes sessionId + portalId + organizationId for tenant isolation.

import type { ScanEvent, Rating, Feedback } from '../../domain/types'
import type { FeedbackId, OrganizationId, PortalId, RatingId } from '#/shared/domain/ids'

export type GuestInteractionRepository = Readonly<{
  recordScan(scan: ScanEvent): Promise<void>
  insertRating(rating: Rating): Promise<void>
  insertFeedback(fb: Feedback): Promise<void>
  hasRated(
    organizationId: OrganizationId,
    sessionId: string,
    portalId: PortalId,
  ): Promise<boolean>
  /**
   * Abuse-detection dedup: has this ipHash already rated this portal within the
   * given window? Guards against cookie-rotation abuse where each request mints
   * a fresh session (and thus bypasses the sessionId-keyed `hasRated` + the
   * session/portal unique constraint). Organization-scoped for tenant isolation.
   */
  hasRatedByIpWithin(
    organizationId: OrganizationId,
    ipHash: string,
    portalId: PortalId,
    withinSeconds: number,
  ): Promise<boolean>
  getLatestScanBySession(
    organizationId: OrganizationId,
    sessionId: string,
  ): Promise<ScanEvent | null>
  /** Lookup feedback by ID — used by cross-context lookup ports. */
  findFeedbackById(id: FeedbackId, orgId: OrganizationId): Promise<Feedback | null>
  /** Lookup rating by ID — used by cross-context lookup ports. */
  findRatingById(id: RatingId, orgId: OrganizationId): Promise<Rating | null>
}>
