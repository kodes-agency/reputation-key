import type { ScanEvent } from '../../domain/types'
import { unbrand } from '#/shared/domain/ids'

export const scanEventToRow = (scan: ScanEvent) => ({
  id: unbrand(scan.id),
  organizationId: unbrand(scan.organizationId),
  portalId: unbrand(scan.portalId),
  propertyId: unbrand(scan.propertyId),
  source: scan.source,
  sessionId: scan.sessionId,
  // Network pressure has a separate seven-day authority. This nullable
  // compatibility slot must never become a second active writer again.
  ipHash: null,
  createdAt: scan.createdAt,
})
