import {
  guestResponsePrivateFeedback,
  guestResponseSessionBindings,
  guestResponses,
} from '#/shared/db/schema/guest.schema'
import type { GuestResponse, GuestResponseStatus } from '../../domain/guest-response'

type ResponseRow = typeof guestResponses.$inferSelect
type ResponseInsert = typeof guestResponses.$inferInsert
type SessionBindingRow = typeof guestResponseSessionBindings.$inferSelect
type PrivateFeedbackRow = typeof guestResponsePrivateFeedback.$inferSelect

export function guestResponseFromRow(
  row: ResponseRow,
  binding: SessionBindingRow | null = null,
  feedback: PrivateFeedbackRow | null = null,
): GuestResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    sessionId: binding?.sessionId ?? null,
    sessionExpiresAt: binding?.expiresAt ?? null,
    status: row.status as GuestResponseStatus,
    rating: row.rating,
    category: row.categoryId,
    text: feedback?.body ?? null,
    responseConsent: row.responseConsent,
    textConsent: row.textConsent,
    mediaConsent: row.mediaConsent,
    privateFeedbackThreshold: row.privateFeedbackThreshold,
    ratingSourceEventId: row.ratingSourceEventId,
    feedbackSourceEventId: row.feedbackSourceEventId,
    contactConsent: false,
    contactDetails: null,
    correctionCount: row.correctionCount === 1 ? 1 : 0,
    submittedAt: row.submittedAt,
    correctedAt: row.correctedAt,
    feedbackSubmittedAt: row.feedbackSubmittedAt,
    feedbackWithdrawnAt: row.feedbackWithdrawnAt,
    moderatedAt: row.moderatedAt,
    deletedAt: row.deletedAt,
    retentionDeadline: row.retentionDeadline,
    schemaVersion: 1,
  }
}

export function guestResponseToInsertRow(response: GuestResponse): ResponseInsert {
  return {
    id: response.id,
    organizationId: response.organizationId,
    propertyId: response.propertyId,
    portalId: response.portalId,
    status: response.status,
    rating: response.rating,
    categoryId: response.category,
    responseConsent: response.responseConsent,
    textConsent: response.textConsent,
    mediaConsent: response.mediaConsent,
    privateFeedbackThreshold: response.privateFeedbackThreshold,
    ratingSourceEventId: response.ratingSourceEventId,
    feedbackSourceEventId: response.feedbackSourceEventId,
    correctionCount: response.correctionCount,
    submittedAt: response.submittedAt,
    correctedAt: response.correctedAt,
    feedbackSubmittedAt: response.feedbackSubmittedAt,
    feedbackWithdrawnAt: response.feedbackWithdrawnAt,
    moderatedAt: response.moderatedAt,
    retentionDeadline: response.retentionDeadline,
    deletedAt: response.deletedAt,
    updatedAt: response.submittedAt ?? new Date(),
  }
}
