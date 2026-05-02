import type { scanEvents, ratings, feedback } from '#/shared/db/schema/guest.schema'
import type { ScanEvent, Rating, Feedback } from '../../domain/types'
import {
  scanEventId,
  ratingId,
  feedbackId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'

type ScanRow = typeof scanEvents.$inferSelect
type RatingRow = typeof ratings.$inferSelect
type FeedbackRow = typeof feedback.$inferSelect

export const scanEventFromRow = (row: ScanRow): ScanEvent => ({
  id: scanEventId(row.id),
  organizationId: organizationId(row.organizationId),
  portalId: portalId(row.portalId),
  propertyId: propertyId(row.propertyId),
  source: row.source as ScanEvent['source'],
  sessionId: row.sessionId,
  ipHash: row.ipHash,
  createdAt: row.createdAt,
})

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

export const ratingFromRow = (row: RatingRow): Rating => ({
  id: ratingId(row.id),
  organizationId: organizationId(row.organizationId),
  portalId: portalId(row.portalId),
  propertyId: propertyId(row.propertyId),
  sessionId: row.sessionId,
  value: row.value,
  source: row.source as Rating['source'],
  ipHash: row.ipHash,
  createdAt: row.createdAt,
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

export const feedbackFromRow = (row: FeedbackRow): Feedback => ({
  id: feedbackId(row.id),
  organizationId: organizationId(row.organizationId),
  portalId: portalId(row.portalId),
  propertyId: propertyId(row.propertyId),
  sessionId: row.sessionId,
  ratingId: row.ratingId ? ratingId(row.ratingId) : null,
  comment: row.comment,
  source: row.source as Feedback['source'],
  ipHash: row.ipHash,
  createdAt: row.createdAt,
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
