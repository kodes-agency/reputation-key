// Inbox context — domain errors
// Per architecture: "Tagged errors with _tag field for pattern matching."

import { createErrorFactory } from '#/shared/domain/errors'

export type InboxErrorCode =
  | 'invalid_transition'
  | 'invalid_input'
  | 'forbidden'
  | 'not_found'
  | 'assignment_not_allowed'
  | 'already_exists'
  | 'bulk_partial_failure'

export type InboxError = Readonly<{
  _tag: 'InboxError'
  code: InboxErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const inboxError = createErrorFactory<InboxError['_tag']>('InboxError')

export const isInboxError = (e: unknown): e is InboxError =>
  typeof e === 'object' && e !== null && (e as InboxError)._tag === 'InboxError'
