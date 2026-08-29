import { createErrorFactory } from '#/shared/domain/errors'

export type GuestErrorCode =
  | 'invalid_rating'
  | 'duplicate_rating'
  | 'duplicate_feedback'
  | 'feedback_too_long'
  | 'feedback_empty'
  | 'portal_not_found'
  | 'portal_inactive'
  | 'rate_limit_exceeded'
  | 'invalid_source'
  | 'invalid_session'
  | 'forbidden'

export type GuestError = Readonly<{
  _tag: 'GuestError'
  code: GuestErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const guestError = createErrorFactory<GuestError['_tag'], GuestError['code']>(
  'GuestError',
)

export const isGuestError = (e: unknown): e is GuestError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'GuestError'

export type ContactRequestErrorCode =
  | 'consent_required'
  | 'purpose_required'
  | 'invalid_purpose'
  | 'invalid_contact'
  | 'duplicate'
  | 'source_unavailable'
  | 'contact_disabled'
  | 'not_found'
  | 'unavailable'
  | 'not_authorized'
  | 'access_purpose_required'
  | 'invalid_batch_size'

export type ContactRequestError = Readonly<{
  _tag: 'ContactRequestError'
  code: ContactRequestErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const contactRequestError = createErrorFactory<
  ContactRequestError['_tag'],
  ContactRequestError['code']
>('ContactRequestError')
