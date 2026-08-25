import { guestResponses } from '#/shared/db/schema/guest.schema'
import type { GuestResponse, GuestResponseStatus } from '../../domain/guest-response'

type ResponseRow = typeof guestResponses.$inferSelect
type ResponseInsert = typeof guestResponses.$inferInsert

export function guestResponseFromRow(row: ResponseRow): GuestResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    sessionId: row.sessionId,
    status: row.status as GuestResponseStatus,
    rating: row.rating,
    category: row.categoryId,
    text: row.responseText,
    responseConsent: row.responseConsent,
    textConsent: row.textConsent,
    mediaConsent: row.mediaConsent,
    contactConsent: false,
    contactDetails: null,
    correctionCount: row.correctionCount === 1 ? 1 : 0,
    submittedAt: row.submittedAt,
    correctedAt: row.correctedAt,
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
    sessionId: response.sessionId,
    status: response.status,
    rating: response.rating,
    categoryId: response.category,
    responseText: response.text,
    responseConsent: response.responseConsent,
    textConsent: response.textConsent,
    mediaConsent: response.mediaConsent,
    correctionCount: response.correctionCount,
    submittedAt: response.submittedAt,
    correctedAt: response.correctedAt,
    moderatedAt: response.moderatedAt,
    retentionDeadline: response.retentionDeadline,
    deletedAt: response.deletedAt,
    updatedAt: response.submittedAt ?? new Date(),
  }
}
