// Goal context — domain errors
// Per architecture: tagged error shape with _tag, code, message.
// Error codes form a closed union so ts-pattern .exhaustive() works at the server boundary.

export type GoalErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'validation_error'
  | 'immutable_goal'

export type GoalError = Readonly<{
  _tag: 'GoalError'
  code: GoalErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

/** Smart constructor — the only way to build a GoalError. */
export const goalError = (
  code: GoalErrorCode,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): GoalError => ({
  _tag: 'GoalError',
  code,
  message,
  ...(context ? { context } : {}),
})

/** Type guard — lets server functions detect GoalError at catch time. */
export const isGoalError = (e: unknown): e is GoalError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'GoalError'
