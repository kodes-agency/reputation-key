// Activity context — domain errors

import { createErrorFactory } from '#/shared/domain/errors'

export type ActivityError = Readonly<{
  _tag: 'ActivityError'
  code: string
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const activityError = createErrorFactory<
  ActivityError['_tag'],
  ActivityError['code']
>('ActivityError')

export const isActivityError = (e: unknown): e is ActivityError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'ActivityError'
