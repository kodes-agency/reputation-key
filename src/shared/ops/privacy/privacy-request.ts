// LIF-01-T20 — the privacy request state machine.
//
//   received -> verified -> in_progress -> fulfilled | refused
//
// NO EDGE SKIPS `verified`. Acting on an unverified request is how one person
// reads, corrects or erases another person's data, and a Guest subject is
// identified only by things anybody could claim to hold — an email address, a
// phone number, a session pseudonym. Verification is the whole control.
//
// Nothing in this module carries subject content. The subject is a SHA-256 of a
// verified identifier; a refusal is a code; a correction names a FIELD, not a
// value. A privacy record about a person's data must not become another copy of
// that person's data.

import { createErrorFactory } from '#/shared/domain/errors'

export const PRIVACY_REQUEST_STATES = [
  'received',
  'verified',
  'in_progress',
  'fulfilled',
  'refused',
] as const

export type PrivacyRequestState = (typeof PRIVACY_REQUEST_STATES)[number]

export const PRIVACY_REQUEST_KINDS = [
  'access',
  'correction',
  'withdrawal',
  'erasure',
] as const

export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KINDS)[number]

export const PRIVACY_SUBJECT_TYPES = ['guest', 'participant'] as const

export type PrivacySubjectType = (typeof PRIVACY_SUBJECT_TYPES)[number]

/**
 * Every refusal is one of these. A free-text reason would be a place to record
 * what the subject said, and would stop a regulator-facing report from being
 * countable.
 */
export const PRIVACY_REFUSAL_REASON_CODES = [
  'identity_not_verified',
  'subject_not_found',
  'out_of_scope_tenant',
  'out_of_scope_property',
  'manifestly_unfounded',
  'legal_hold',
  'retention_obligation',
  'duplicate_request',
] as const

export type PrivacyRefusalReasonCode = (typeof PRIVACY_REFUSAL_REASON_CODES)[number]

const VALID_TRANSITIONS: Readonly<
  Record<PrivacyRequestState, readonly PrivacyRequestState[]>
> = {
  received: ['verified', 'refused'],
  verified: ['in_progress', 'refused'],
  in_progress: ['fulfilled', 'refused'],
  fulfilled: [],
  refused: [],
}

export type PrivacyRequestErrorCode =
  | 'invalid_transition'
  | 'identity_not_verified'
  | 'refusal_reason_required'
  | 'subject_scope_violation'
  | 'subject_content_in_record'
  | 'package_not_expiry_bound'
  | 'request_not_found'
  | 'correction_not_delivered'

export type PrivacyRequestError = Readonly<{
  _tag: 'PrivacyRequestError'
  code: PrivacyRequestErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const privacyRequestError = createErrorFactory<
  PrivacyRequestError['_tag'],
  PrivacyRequestError['code']
>('PrivacyRequestError')

export const isPrivacyRequestError = (error: unknown): error is PrivacyRequestError =>
  typeof error === 'object' &&
  error !== null &&
  (error as { _tag?: string })._tag === 'PrivacyRequestError'

export function isValidPrivacyRequestTransition(
  from: PrivacyRequestState,
  to: PrivacyRequestState,
): boolean {
  return VALID_TRANSITIONS[from].includes(to)
}

/**
 * Assert a transition, with a refusal reason when the target is `refused`.
 *
 * `received -> in_progress` and `received -> fulfilled` are refused with the
 * dedicated `identity_not_verified` code rather than the generic transition
 * error, because that specific mistake is the one that leaks data.
 */
export function assertValidPrivacyRequestTransition(
  from: PrivacyRequestState,
  to: PrivacyRequestState,
  refusalReasonCode?: PrivacyRefusalReasonCode,
): void {
  if (from === 'received' && (to === 'in_progress' || to === 'fulfilled')) {
    throw privacyRequestError(
      'identity_not_verified',
      'A privacy request cannot be acted on before the subject identity is verified',
      { from, to },
    )
  }
  if (!isValidPrivacyRequestTransition(from, to)) {
    throw privacyRequestError(
      'invalid_transition',
      `Invalid privacy request transition from "${from}" to "${to}"`,
      { from, to },
    )
  }
  if (to === 'refused' && refusalReasonCode === undefined) {
    throw privacyRequestError(
      'refusal_reason_required',
      'A refused privacy request must carry an explicit reason code',
    )
  }
}

/** States in which the request is finished and may not move again. */
export function isPrivacyRequestTerminal(state: PrivacyRequestState): boolean {
  return state === 'fulfilled' || state === 'refused'
}

const SHA256 = /^[0-9a-f]{64}$/u
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/u

/**
 * The record must never hold subject content.
 *
 * Called on every write path. A subject reference that is not a digest is,
 * almost always, the raw email address someone pasted in.
 */
export function assertContentFreePrivacySubject(
  subjectRef: string,
  targetField?: string,
): void {
  if (!SHA256.test(subjectRef)) {
    throw privacyRequestError(
      'subject_content_in_record',
      'A privacy subject is identified by the SHA-256 of a verified identifier, never the identifier itself',
    )
  }
  if (targetField !== undefined && !FIELD_NAME.test(targetField)) {
    throw privacyRequestError(
      'subject_content_in_record',
      'A correction names a schema field, never a value',
    )
  }
}
