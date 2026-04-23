// Identity context — domain errors
// Per architecture: tagged error shape with _tag, code, message.
// Per patterns: "The smart constructor is the only way to build an error."
// "isXxxError type guard lets server functions detect 'this is my error' at catch time."
// Error codes are a closed union so ts-pattern .exhaustive() works at the server boundary.

export type IdentityErrorCode =
  | 'forbidden'
  | 'invalid_slug'
  | 'invalid_name'
  | 'member_not_found'
  | 'invitation_not_found'
  | 'registration_failed'
  | 'org_setup_failed'

export type IdentityError = Readonly<{
  _tag: 'IdentityError'
  code: IdentityErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

/** Smart constructor — the only way to build an IdentityError. */
export const identityError = (
  code: IdentityErrorCode,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): IdentityError => ({
  _tag: 'IdentityError',
  code,
  message,
  ...(context ? { context } : {}),
})

/** Type guard — lets server functions detect IdentityError at catch time. */
export const isIdentityError = (e: unknown): e is IdentityError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'IdentityError'
