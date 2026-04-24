// Property context — domain errors
// Per architecture: tagged error shape with _tag, code, message.
// Error codes form a closed union so ts-pattern .exhaustive() works at the server boundary.

export type PropertyErrorCode =
  | 'forbidden'
  | 'invalid_slug'
  | 'invalid_name'
  | 'invalid_timezone'
  | 'slug_taken'
  | 'property_not_found'

export type PropertyError = Readonly<{
  _tag: 'PropertyError'
  code: PropertyErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

/** Smart constructor — the only way to build a PropertyError. */
export const propertyError = (
  code: PropertyErrorCode,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): PropertyError => ({
  _tag: 'PropertyError',
  code,
  message,
  ...(context ? { context } : {}),
})

/** Type guard — lets server functions detect PropertyError at catch time. */
export const isPropertyError = (e: unknown): e is PropertyError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'PropertyError'
