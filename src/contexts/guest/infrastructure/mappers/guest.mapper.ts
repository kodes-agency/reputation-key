import type { ScanEvent, Rating, Feedback } from '../../domain/types'
import { unbrand } from '#/shared/domain/ids'

export const scanEventToRow = (scan: ScanEvent) => ({
  id: unbrand(scan.id),
  organizationId: scan.organizationId as string,
  portalId: scan.portalId as string,
  propertyId: scan.propertyId as string,
  source: scan.source,
  sessionId: scan.sessionId,
  ipHash: scan.ipHash,
  staffId: scan.staffId as string | null,
  createdAt: scan.createdAt,
})

export const ratingToRow = (rating: Rating) => ({
  id: unbrand(rating.id),
  organizationId: rating.organizationId as string,
  portalId: rating.portalId as string,
  propertyId: rating.propertyId as string,
  sessionId: rating.sessionId,
  value: rating.value,
  source: rating.source,
  ipHash: rating.ipHash,
  staffId: rating.staffId as string | null,
  createdAt: rating.createdAt,
})

export const feedbackToRow = (fb: Feedback) => ({
  id: unbrand(fb.id),
  organizationId: fb.organizationId as string,
  portalId: fb.portalId as string,
  propertyId: fb.propertyId as string,
  sessionId: fb.sessionId,
  ratingId: fb.ratingId as string | null,
  comment: fb.comment,
  source: fb.source,
  ipHash: fb.ipHash,
  staffId: fb.staffId as string | null,
  createdAt: fb.createdAt,
})
