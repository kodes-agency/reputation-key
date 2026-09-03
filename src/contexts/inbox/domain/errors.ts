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
  | 'revision_conflict'
  | 'bulk_partial_failure'

export type InboxError = Readonly<{
  _tag: 'InboxError'
  code: InboxErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const inboxError = createErrorFactory<InboxError['_tag'], InboxError['code']>(
  'InboxError',
)

/**
 * The client cannot read `code` off a rejected server function: TanStack Start
 * rebuilds the error during deserialization and only the message survives
 * intact (the same reason `google-import-error-messages.ts` falls back to
 * parsing text). Conflict recovery in the Inbox mutation path therefore matches
 * this exact string, so it has one authority.
 */
export const REVISION_CONFLICT_MESSAGE = 'Inbox item changed; reload current state'

export const isInboxError = (e: unknown): e is InboxError =>
  typeof e === 'object' && e !== null && (e as InboxError)._tag === 'InboxError'
