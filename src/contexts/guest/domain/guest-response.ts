// POST-BETA-2 PB2.4: Guest response aggregate domain.
//
// Per ADR 0044: rating and feedback submit as one aggregate, not
// independent partial records. The guest explicitly submits, receives
// status, and may make one bounded correction through the same signed
// session during a short window.
//
// After the private rating, Google Review Action visibility/order/prominence is
// invariant across all five values. Eligible feedback is additive and follows it.

import {
  DEFAULT_GUEST_RESPONSE_INTEGRITY_ASSESSMENT,
  type GuestResponseInitialIntegrityAssessment,
  type GuestResponseIntegrityOutcome,
} from './guest-response-integrity'

export type GuestResponseStatus =
  'pending' | 'submitted' | 'corrected' | 'moderated' | 'deleted' | 'expired'

/**
 * Server-resolved experience that was actually in force for the initial rating.
 * It is persisted in a separate immutable-by-contract record so later Portal
 * edits are prospective and legacy rows can remain honestly unknown.
 */
export type GuestResponseExperienceSnapshot = Readonly<{
  portalPublicationState: 'published'
  portalConfigurationDigest: string
  guestLocale: string
  languagePackVersion: string
  privateFeedbackThreshold: number
  capturedAt: Date
}>

export interface GuestResponse {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly portalId: string
  /** Present only while the independent recovery binding is still retained. */
  readonly sessionId: string | null
  readonly sessionExpiresAt: Date | null
  readonly status: GuestResponseStatus
  /** Metric eligibility is independent from content moderation/lifecycle status. */
  readonly integrityOutcome: GuestResponseIntegrityOutcome
  readonly integrityReasonCode: string
  readonly integrityRevision: number
  readonly integrityAssessedAt: Date
  readonly rating: number | null
  readonly category: string | null
  readonly text: string | null
  readonly responseConsent: boolean
  readonly textConsent: boolean
  readonly mediaConsent: boolean
  /** Inclusive Portal threshold captured with the initial private rating. */
  readonly privateFeedbackThreshold: number | null
  /** Null only for pre-snapshot historical responses. New submissions require it. */
  readonly experienceSnapshot: GuestResponseExperienceSnapshot | null
  /** Durable lineage of the currently effective numeric rating fact. */
  readonly ratingSourceEventId: string | null
  /** Durable lineage of the currently effective private-feedback count fact. */
  readonly feedbackSourceEventId: string | null
  readonly contactConsent: boolean
  readonly contactDetails: string | null
  readonly correctionCount: 0 | 1
  readonly submittedAt: Date | null
  readonly correctedAt: Date | null
  readonly feedbackSubmittedAt: Date | null
  /** Content-free tombstone that prevents a withdrawn feedback body being resubmitted. */
  readonly feedbackWithdrawnAt: Date | null
  readonly moderatedAt: Date | null
  readonly deletedAt: Date | null
  readonly retentionDeadline: Date
  readonly schemaVersion: number
}

export type ResponseError =
  | { code: 'already_submitted' }
  | { code: 'correction_window_expired' }
  | { code: 'already_deleted' }
  | { code: 'rating_out_of_range'; rating: number }
  | { code: 'text_too_long'; length: number; max: number }
  | { code: 'no_content' }
  | { code: 'contact_without_consent' }
  | { code: 'feedback_not_eligible' }
  | { code: 'feedback_already_submitted' }
  | { code: 'feedback_not_found' }
  | { code: 'feedback_withdrawal_expired' }
  | { code: 'response_not_submitted' }
  | { code: 'response_withdrawal_expired' }

export const MAX_TEXT_LENGTH = 2000
export const MAX_RATING = 5
export const MIN_RATING = 1
const DEFAULT_CORRECTION_WINDOW_MS = 60 * 60 * 1000 // 1 hour
export const DEFAULT_FEEDBACK_WITHDRAWAL_WINDOW_MS = 24 * 60 * 60 * 1000
export const DEFAULT_RESPONSE_WITHDRAWAL_WINDOW_MS = 24 * 60 * 60 * 1000
export const DEFAULT_RESPONSE_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000
export const PRIVATE_FEEDBACK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export function createResponse(params: {
  id: string
  organizationId: string
  propertyId: string
  portalId: string
  sessionId: string
  sessionExpiresAt: Date
  retentionDeadline: Date
  experienceSnapshot: GuestResponseExperienceSnapshot
  integrityAssessment?: GuestResponseInitialIntegrityAssessment
}): GuestResponse {
  const integrityAssessment =
    params.integrityAssessment ?? DEFAULT_GUEST_RESPONSE_INTEGRITY_ASSESSMENT
  return {
    id: params.id,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    portalId: params.portalId,
    sessionId: params.sessionId,
    sessionExpiresAt: params.sessionExpiresAt,
    status: 'pending',
    integrityOutcome: integrityAssessment.outcome,
    integrityReasonCode: integrityAssessment.reasonCode,
    integrityRevision: 1,
    integrityAssessedAt: params.experienceSnapshot.capturedAt,
    rating: null,
    category: null,
    text: null,
    responseConsent: false,
    textConsent: false,
    mediaConsent: false,
    privateFeedbackThreshold: params.experienceSnapshot.privateFeedbackThreshold,
    experienceSnapshot: params.experienceSnapshot,
    ratingSourceEventId: null,
    feedbackSourceEventId: null,
    contactConsent: false,
    contactDetails: null,
    correctionCount: 0,
    submittedAt: null,
    correctedAt: null,
    feedbackSubmittedAt: null,
    feedbackWithdrawnAt: null,
    moderatedAt: null,
    deletedAt: null,
    retentionDeadline: params.retentionDeadline,
    schemaVersion: 1,
  }
}

/**
 * Add private written feedback after the rating has been durably captured.
 * This is a separate act from the one permitted rating correction, so it never
 * changes `correctionCount` or rewrites the numeric rating.
 */
export function submitPrivateFeedback(
  response: GuestResponse,
  params: Readonly<{ text: string; textConsent: boolean }>,
  now: Date,
): GuestResponse | ResponseError {
  if (response.status === 'deleted') return { code: 'already_deleted' }
  if (response.status !== 'submitted' && response.status !== 'corrected') {
    return { code: 'already_submitted' }
  }
  if (
    response.text !== null ||
    response.feedbackSourceEventId !== null ||
    response.feedbackSubmittedAt !== null ||
    response.feedbackWithdrawnAt !== null
  ) {
    return { code: 'feedback_already_submitted' }
  }
  if (
    response.rating === null ||
    response.privateFeedbackThreshold === null ||
    response.rating > response.privateFeedbackThreshold
  ) {
    return { code: 'feedback_not_eligible' }
  }
  const text = params.text.trim()
  if (text.length === 0) return { code: 'no_content' }
  if (text.length > MAX_TEXT_LENGTH) {
    return { code: 'text_too_long', length: text.length, max: MAX_TEXT_LENGTH }
  }
  if (!params.textConsent) return { code: 'no_content' }

  return {
    ...response,
    text,
    textConsent: true,
    feedbackSubmittedAt: now,
  }
}

/**
 * Withdraw only the private written feedback. The private rating remains the
 * effective managerial reading. A content-free tombstone prevents the same
 * signed session from creating a second feedback item after withdrawal.
 */
export function withdrawPrivateFeedback(
  response: GuestResponse,
  now: Date,
  withdrawalWindowMs: number = DEFAULT_FEEDBACK_WITHDRAWAL_WINDOW_MS,
): GuestResponse | ResponseError {
  if (response.status === 'deleted') return { code: 'already_deleted' }
  if (
    response.text === null ||
    response.feedbackSubmittedAt === null ||
    response.feedbackSourceEventId === null
  ) {
    return { code: 'feedback_not_found' }
  }
  if (now.getTime() - response.feedbackSubmittedAt.getTime() > withdrawalWindowMs) {
    return { code: 'feedback_withdrawal_expired' }
  }
  return {
    ...response,
    text: null,
    textConsent: false,
    feedbackSourceEventId: null,
    contactConsent: false,
    contactDetails: null,
    feedbackWithdrawnAt: now,
  }
}

/** Guest-owned whole-response withdrawal, bounded from initial rating submission. */
export function withdrawResponse(
  response: GuestResponse,
  now: Date,
  withdrawalWindowMs: number = DEFAULT_RESPONSE_WITHDRAWAL_WINDOW_MS,
): GuestResponse | ResponseError {
  if (response.status === 'deleted') return { code: 'already_deleted' }
  if (response.submittedAt === null) return { code: 'response_not_submitted' }
  if (now.getTime() - response.submittedAt.getTime() > withdrawalWindowMs) {
    return { code: 'response_withdrawal_expired' }
  }
  return deleteResponse(response, now)
}

/**
 * Submit a response. Validates rating, text length, and consent.
 * Per ADR 0044: optional rating, optional category, optional text —
 * but at least one meaningful field must be present.
 */
export function submitResponse(
  response: GuestResponse,
  params: {
    rating?: number | null
    category?: string | null
    text?: string | null
    responseConsent?: boolean
    textConsent?: boolean
    mediaConsent?: boolean
    contactConsent?: boolean
    contactDetails?: string | null
  },
  now: Date,
): GuestResponse | ResponseError {
  if (response.status === 'deleted') {
    return { code: 'already_deleted' }
  }

  if (response.status !== 'pending') {
    return { code: 'already_submitted' }
  }

  const hasContent =
    params.rating != null || (params.text != null && params.text.trim().length > 0)

  if (!hasContent) {
    return { code: 'no_content' }
  }

  if (
    params.rating != null &&
    (params.rating < MIN_RATING || params.rating > MAX_RATING)
  ) {
    return { code: 'rating_out_of_range', rating: params.rating }
  }

  const text = params.text?.trim() ?? ''
  if (text.length > MAX_TEXT_LENGTH) {
    return { code: 'text_too_long', length: text.length, max: MAX_TEXT_LENGTH }
  }

  if (params.rating != null && params.responseConsent === false) {
    return { code: 'no_content' }
  }
  if (text && params.textConsent === false) {
    return { code: 'no_content' }
  }
  if (params.contactDetails && !params.contactConsent) {
    return { code: 'contact_without_consent' }
  }

  return {
    ...response,
    status: 'submitted',
    rating: params.rating ?? null,
    category: params.category ?? null,
    text: text || null,
    responseConsent: params.responseConsent ?? params.rating != null,
    textConsent: params.textConsent ?? text.length > 0,
    mediaConsent: params.mediaConsent ?? false,
    contactConsent: params.contactConsent ?? false,
    contactDetails: params.contactDetails ?? null,
    submittedAt: now,
    feedbackSubmittedAt: text ? now : null,
  }
}

/**
 * Correct a submitted response within the correction window.
 * Per ADR 0044: one bounded correction through the same signed session.
 */
export function correctResponse(
  response: GuestResponse,
  params: {
    rating?: number | null
    category?: string | null
    text?: string | null
    responseConsent?: boolean
    textConsent?: boolean
    mediaConsent?: boolean
    contactConsent?: boolean
    contactDetails?: string | null
  },
  now: Date,
  correctionWindowMs: number = DEFAULT_CORRECTION_WINDOW_MS,
): GuestResponse | ResponseError {
  if (response.status === 'deleted') {
    return { code: 'already_deleted' }
  }

  if (response.status === 'pending' || response.correctionCount !== 0) {
    return { code: 'already_submitted' }
  }

  // Check correction window
  if (response.submittedAt) {
    const elapsed = now.getTime() - response.submittedAt.getTime()
    if (elapsed > correctionWindowMs) {
      return { code: 'correction_window_expired' }
    }
  }

  // Re-validate
  if (
    params.rating != null &&
    (params.rating < MIN_RATING || params.rating > MAX_RATING)
  ) {
    return { code: 'rating_out_of_range', rating: params.rating }
  }

  const text = params.text?.trim() ?? ''
  if (text.length > MAX_TEXT_LENGTH) {
    return { code: 'text_too_long', length: text.length, max: MAX_TEXT_LENGTH }
  }

  const rating = params.rating === undefined ? response.rating : params.rating
  const nextText = params.text === undefined ? response.text : text || null
  if (rating == null && nextText == null) return { code: 'no_content' }
  if (params.contactDetails && !params.contactConsent && !response.contactConsent) {
    return { code: 'contact_without_consent' }
  }

  return {
    ...response,
    status: 'corrected',
    rating,
    category: params.category === undefined ? response.category : params.category,
    text: nextText,
    responseConsent: params.responseConsent ?? response.responseConsent,
    textConsent: params.textConsent ?? response.textConsent,
    mediaConsent: params.mediaConsent ?? response.mediaConsent,
    contactConsent: params.contactConsent ?? response.contactConsent,
    contactDetails:
      params.contactDetails === undefined
        ? response.contactDetails
        : params.contactDetails,
    correctionCount: 1,
    correctedAt: now,
  }
}

/**
 * Moderate a response (manager action). Does not destroy evidence.
 */
export function moderateResponse(
  response: GuestResponse,
  now: Date,
): GuestResponse | ResponseError {
  if (response.status === 'deleted') {
    return { code: 'already_deleted' }
  }
  return {
    ...response,
    status: 'moderated',
    moderatedAt: now,
  }
}

/**
 * Delete/anonymize a response. Per ADR 0044: deletion workflow
 * purges projection/cache/search/media copies.
 */
export function deleteResponse(
  response: GuestResponse,
  now: Date,
): GuestResponse | ResponseError {
  if (response.status === 'deleted') {
    return { code: 'already_deleted' }
  }
  return {
    ...response,
    status: 'deleted',
    rating: null,
    category: null,
    text: null,
    responseConsent: false,
    textConsent: false,
    mediaConsent: false,
    contactConsent: false,
    contactDetails: null,
    feedbackSubmittedAt: response.feedbackSubmittedAt,
    deletedAt: now,
  }
}
