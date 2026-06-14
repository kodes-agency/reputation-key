// Badge context — domain errors

import { createErrorFactory } from '#/shared/domain/errors'

export type BadgeErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'repo_insert_failed'

export type BadgeError = Readonly<{
  _tag: 'BadgeError'
  code: BadgeErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const badgeError = createErrorFactory<BadgeError['_tag']>('BadgeError')

export const isBadgeError = (e: unknown): e is BadgeError =>
  typeof e === 'object' && e !== null && (e as BadgeError)._tag === 'BadgeError'
