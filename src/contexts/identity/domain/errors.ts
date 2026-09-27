// Identity context — domain errors
// Per architecture: tagged error shape with _tag, code, message.
// Per patterns: "The smart constructor is the only way to build an error."
// "isXxxError type guard lets server functions detect 'this is my error' at catch time."
// Error codes are a closed union so ts-pattern .exhaustive() works at the server boundary.

import { createErrorFactory } from '#/shared/domain/errors'

export type IdentityErrorCode =
  | 'forbidden'
  | 'invalid_slug'
  | 'invalid_name'
  | 'validation_error'
  | 'member_not_found'
  | 'invitation_not_found'
  | 'registration_failed'
  | 'already_exists'
  | 'organization_conflict'
  | 'last_owner'
  | 'org_setup_failed'
  | 'feedback_triage_invalid'

export type IdentityError = Readonly<{
  _tag: 'IdentityError'
  code: IdentityErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

/** Smart constructor — the only way to build an IdentityError. */
export const identityError = createErrorFactory<
  IdentityError['_tag'],
  IdentityError['code']
>('IdentityError')

/** Type guard — lets server functions detect IdentityError at catch time. */
export const isIdentityError = (e: unknown): e is IdentityError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'IdentityError'

export type BetaFeedbackErrorCode = 'temporarily_unavailable'

/**
 * A beta-feedback report the request path could not complete. The report is
 * durably recorded as failed, so the reporter is asked to try again. The wire
 * error is `FeedbackError`; the tag differs so this guard never matches an
 * already-mapped `FeedbackError` server error such as the rate limit's 429.
 */
export type BetaFeedbackError = Readonly<{
  _tag: 'BetaFeedbackError'
  code: BetaFeedbackErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

/** Smart constructor — the only way to build a BetaFeedbackError. */
export const betaFeedbackError = createErrorFactory<
  BetaFeedbackError['_tag'],
  BetaFeedbackError['code']
>('BetaFeedbackError')

/** Type guard — lets the beta-feedback server functions map a BetaFeedbackError. */
export const isBetaFeedbackError = (e: unknown): e is BetaFeedbackError =>
  typeof e === 'object' &&
  e !== null &&
  (e as { _tag?: string })._tag === 'BetaFeedbackError'
