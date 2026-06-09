// Activity context — domain errors

export type ActivityError = Readonly<{
  _tag: 'ActivityError'
  code: string
  message: string
  details?: Record<string, unknown>
}>

export const activityError = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ActivityError => ({
  _tag: 'ActivityError',
  code,
  message,
  ...(details ? { details } : {}),
})
