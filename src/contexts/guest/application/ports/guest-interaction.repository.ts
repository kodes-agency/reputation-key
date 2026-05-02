// Guest context — repository port for guest write operations.
// Single repo because all guest interactions are writes.
// recordScan/insertRating/insertFeedback take domain objects (which carry organizationId).
// hasRated takes sessionId + portalId + organizationId for tenant isolation.

import type { ScanEvent, Rating, Feedback } from '../../domain/types'
import type { OrganizationId, PortalId } from '#/shared/domain/ids'

export type GuestInteractionRepository = Readonly<{
  recordScan(scan: ScanEvent): Promise<void>
  insertRating(rating: Rating): Promise<void>
  insertFeedback(fb: Feedback): Promise<void>
  hasRated(
    organizationId: OrganizationId,
    sessionId: string,
    portalId: PortalId,
  ): Promise<boolean>
}>
