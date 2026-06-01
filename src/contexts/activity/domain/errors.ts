// Activity context — domain errors

export type ActivityError = Readonly<{
  code: string
  message: string
  details?: Record<string, unknown>
}>

export const activityError = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ActivityError => ({
  code,
  message,
  ...(details ? { details } : {}),
})
