import type { ScanEvent, Rating, Feedback } from '../../domain/types'
import {
  unbrand,
  scanEventId,
  organizationId,
  portalId,
  propertyId,
  staffId,
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
  staffId: row.staffId ? staffId(row.staffId) : null,
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
  staffId: row.staffId ? staffId(row.staffId) : null,
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
  staffId: row.staffId ? staffId(row.staffId) : null,
  createdAt: row.createdAt,
})

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
