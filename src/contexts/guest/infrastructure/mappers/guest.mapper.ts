import type { ScanEvent, Rating, Feedback } from '../../domain/types'

export const scanEventToRow = (scan: ScanEvent) => ({
  id: scan.id as unknown as string,
  organizationId: scan.organizationId as unknown as string,
  portalId: scan.portalId as unknown as string,
  propertyId: scan.propertyId as unknown as string,
  source: scan.source,
  sessionId: scan.sessionId,
  ipHash: scan.ipHash,
  createdAt: scan.createdAt,
})

export const ratingToRow = (rating: Rating) => ({
  id: rating.id as unknown as string,
  organizationId: rating.organizationId as unknown as string,
  portalId: rating.portalId as unknown as string,
  propertyId: rating.propertyId as unknown as string,
  sessionId: rating.sessionId,
  value: rating.value,
  source: rating.source,
  ipHash: rating.ipHash,
  createdAt: rating.createdAt,
})

export const feedbackToRow = (fb: Feedback) => ({
  id: fb.id as unknown as string,
  organizationId: fb.organizationId as unknown as string,
  portalId: fb.portalId as unknown as string,
  propertyId: fb.propertyId as unknown as string,
  sessionId: fb.sessionId,
  ratingId: fb.ratingId as unknown as string | null,
  comment: fb.comment,
  source: fb.source,
  ipHash: fb.ipHash,
  createdAt: fb.createdAt,
})
