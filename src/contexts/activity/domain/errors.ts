// Activity context — domain errors

export type ActivityError = Readonly<{
  _tag: 'ActivityError'
  code: string
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const activityError = (
  code: string,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): ActivityError => ({
  _tag: 'ActivityError',
  code,
  message,
  ...(context ? { context } : {}),
})

export const isActivityError = (e: unknown): e is ActivityError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'ActivityError'
