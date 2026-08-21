// POST-BETA-2 PB2.4: Guest response aggregate domain.
//
// Per ADR 0044: rating and feedback submit as one aggregate, not
// independent partial records. The guest explicitly submits, receives
// status, and may make one bounded correction through the same signed
// session during a short window.
//
// Review-link visibility/order/prominence is invariant regardless of
// the guest's response — enforced by architectural test (anti-gating).

export type GuestResponseStatus =
  'pending' | 'submitted' | 'corrected' | 'moderated' | 'deleted' | 'expired'

export interface GuestResponse {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly portalId: string
  readonly sessionId: string
  readonly status: GuestResponseStatus
  readonly rating: number | null
  readonly category: string | null
  readonly text: string | null
  readonly responseConsent: boolean
  readonly textConsent: boolean
  readonly mediaConsent: boolean
  readonly contactConsent: boolean
  readonly contactDetails: string | null
  readonly correctionCount: 0 | 1
  readonly submittedAt: Date | null
  readonly correctedAt: Date | null
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

export const MAX_TEXT_LENGTH = 2000
export const MAX_RATING = 5
export const MIN_RATING = 1
const DEFAULT_CORRECTION_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export function createResponse(params: {
  id: string
  organizationId: string
  propertyId: string
  portalId: string
  sessionId: string
  retentionDeadline: Date
}): GuestResponse {
  return {
    id: params.id,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    portalId: params.portalId,
    sessionId: params.sessionId,
    status: 'pending',
    rating: null,
    category: null,
    text: null,
    responseConsent: false,
    textConsent: false,
    mediaConsent: false,
    contactConsent: false,
    contactDetails: null,
    correctionCount: 0,
    submittedAt: null,
    correctedAt: null,
    moderatedAt: null,
    deletedAt: null,
    retentionDeadline: params.retentionDeadline,
    schemaVersion: 1,
  }
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
    deletedAt: now,
  }
}
