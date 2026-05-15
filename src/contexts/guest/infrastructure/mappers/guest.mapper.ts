import type { ScanEvent, Rating, Feedback } from '../../domain/types'

export const scanEventToRow = (scan: ScanEvent) => ({
  id: scan.id as string,
  organizationId: scan.organizationId as string,
  portalId: scan.portalId as string,
  propertyId: scan.propertyId as string,
  source: scan.source,
  sessionId: scan.sessionId,
  ipHash: scan.ipHash,
  createdAt: scan.createdAt,
})

export const ratingToRow = (rating: Rating) => ({
  id: rating.id as string,
  organizationId: rating.organizationId as string,
  portalId: rating.portalId as string,
  propertyId: rating.propertyId as string,
  sessionId: rating.sessionId,
  value: rating.value,
  source: rating.source,
  ipHash: rating.ipHash,
  createdAt: rating.createdAt,
})

export const feedbackToRow = (fb: Feedback) => ({
  id: fb.id as string,
  organizationId: fb.organizationId as string,
  portalId: fb.portalId as string,
  propertyId: fb.propertyId as string,
  sessionId: fb.sessionId,
  ratingId: fb.ratingId as string | null,
  comment: fb.comment,
  source: fb.source,
  ipHash: fb.ipHash,
  createdAt: fb.createdAt,
})
