import {
  guestResponseExperienceSnapshots,
  guestResponsePrivateFeedback,
  guestResponseSessionBindings,
  guestResponses,
} from '#/shared/db/schema/guest.schema'
import type { GuestResponse, GuestResponseStatus } from '../../domain/guest-response'
import type { GuestResponseIntegrityOutcome } from '../../domain/guest-response-integrity'

type ResponseRow = typeof guestResponses.$inferSelect
type ResponseInsert = typeof guestResponses.$inferInsert
type ExperienceSnapshotRow = typeof guestResponseExperienceSnapshots.$inferSelect
type SessionBindingRow = typeof guestResponseSessionBindings.$inferSelect
type PrivateFeedbackRow = typeof guestResponsePrivateFeedback.$inferSelect

export function guestResponseFromRow(
  row: ResponseRow,
  binding: SessionBindingRow | null = null,
  feedback: PrivateFeedbackRow | null = null,
  experience: ExperienceSnapshotRow | null = null,
): GuestResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    sessionId: binding?.sessionId ?? null,
    sessionExpiresAt: binding?.expiresAt ?? null,
    status: row.status as GuestResponseStatus,
    integrityOutcome: row.integrityOutcome as GuestResponseIntegrityOutcome,
    integrityReasonCode: row.integrityReasonCode,
    integrityRevision: row.integrityRevision,
    integrityAssessedAt: row.integrityAssessedAt,
    rating: row.rating,
    category: row.categoryId,
    text: feedback?.body ?? null,
    responseConsent: row.responseConsent,
    textConsent: row.textConsent,
    mediaConsent: row.mediaConsent,
    privateFeedbackThreshold: row.privateFeedbackThreshold,
    experienceSnapshot: experience
      ? {
          portalPublicationState: 'published',
          portalPublicationSnapshotId: experience.publicationSnapshotId,
          portalPublicationVersion: experience.publicationVersion,
          portalPublicationDigest: experience.publicationDigest,
          portalConfigurationDigest: experience.configurationDigest,
          guestLocale: experience.guestLocale,
          languagePackVersion: experience.languagePackVersion,
          privateFeedbackThreshold: experience.privateFeedbackThreshold,
          capturedAt: experience.capturedAt,
        }
      : null,
    ratingSourceEventId: row.ratingSourceEventId,
    feedbackSourceEventId: row.feedbackSourceEventId,
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
    integrityOutcome: response.integrityOutcome,
    integrityReasonCode: response.integrityReasonCode,
    integrityRevision: response.integrityRevision,
    integrityAssessedAt: response.integrityAssessedAt,
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
