// Guest context — repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Every method takes organizationId as the first parameter (tenant isolation).

import type { ScanEvent, Rating, Feedback } from '../../domain/types'
import type { PortalId } from '#/shared/domain/ids'

export type GuestInteractionRepository = Readonly<{
  recordScan(scan: ScanEvent): Promise<void>
  insertRating(rating: Rating): Promise<void>
  insertFeedback(fb: Feedback): Promise<void>
  hasRated(sessionId: string, portalId: PortalId): Promise<boolean>
}>
