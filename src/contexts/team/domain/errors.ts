// Team context — domain errors
// Per architecture: tagged error shape with _tag, code, message.
// Error codes form a closed union so ts-pattern .exhaustive() works at the server boundary.

export type TeamErrorCode =
  | 'forbidden'
  | 'invalid_name'
  | 'name_taken'
  | 'team_not_found'
  | 'property_not_found'

export type TeamError = Readonly<{
  _tag: 'TeamError'
  code: TeamErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

/** Smart constructor — the only way to build a TeamError. */
export const teamError = (
  code: TeamErrorCode,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): TeamError => ({
  _tag: 'TeamError',
  code,
  message,
  ...(context ? { context } : {}),
})

/** Type guard — lets server functions detect TeamError at catch time. */
export const isTeamError = (e: unknown): e is TeamError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'TeamError'
