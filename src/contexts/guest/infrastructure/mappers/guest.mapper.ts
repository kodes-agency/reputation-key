import type { ScanEvent, Rating, Feedback } from '../../domain/types'
import {
  unbrand,
  scanEventId,
  organizationId,
  portalId,
  propertyId,
  ratingId,
  feedbackId,
} from '#/shared/domain/ids'
import type { scanEvents, ratings, feedback } from '#/shared/db/schema/guest.schema'

type ScanEventRow = typeof scanEvents.$inferSelect
type RatingRow = typeof ratings.$inferSelect
type FeedbackRow = typeof feedback.$inferSelect

export const scanEventFromRow = (row: ScanEventRow): ScanEvent => ({
  id: scanEventId(row.id),
  organizationId: organizationId(row.organizationId),
  portalId: portalId(row.portalId),
  propertyId: propertyId(row.propertyId),
  source: row.source as ScanEvent['source'],
  sessionId: row.sessionId,
  ipHash: row.ipHash,
  createdAt: row.createdAt,
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

export const scanEventToRow = (scan: ScanEvent) => ({
  id: unbrand(scan.id),
  organizationId: unbrand(scan.organizationId),
  portalId: unbrand(scan.portalId),
  propertyId: unbrand(scan.propertyId),
  source: scan.source,
  sessionId: scan.sessionId,
  ipHash: scan.ipHash,
  createdAt: scan.createdAt,
})

export const ratingToRow = (rating: Rating) => ({
  id: unbrand(rating.id),
  organizationId: unbrand(rating.organizationId),
  portalId: unbrand(rating.portalId),
  propertyId: unbrand(rating.propertyId),
  sessionId: rating.sessionId,
  value: rating.value,
  source: rating.source,
  ipHash: rating.ipHash,
  createdAt: rating.createdAt,
})

export const feedbackToRow = (fb: Feedback) => ({
  id: unbrand(fb.id),
  organizationId: unbrand(fb.organizationId),
  portalId: unbrand(fb.portalId),
  propertyId: unbrand(fb.propertyId),
  sessionId: fb.sessionId,
  ratingId: fb.ratingId != null ? unbrand(fb.ratingId) : null,
  comment: fb.comment,
  source: fb.source,
  ipHash: fb.ipHash,
  createdAt: fb.createdAt,
})
