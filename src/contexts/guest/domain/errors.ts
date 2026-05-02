export type GuestErrorCode =
  | 'invalid_rating'
  | 'duplicate_rating'
  | 'feedback_too_long'
  | 'feedback_empty'
  | 'portal_not_found'
  | 'portal_inactive'
  | 'rate_limit_exceeded'
  | 'invalid_source'
  | 'invalid_session'

export type GuestError = Readonly<{
  _tag: 'GuestError'
  code: GuestErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const guestError = (
  code: GuestErrorCode,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): GuestError => ({
  _tag: 'GuestError',
  code,
  message,
  ...(context ? { context } : {}),
})

export const isGuestError = (e: unknown): e is GuestError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'GuestError'
