// Inbox context — domain errors
// Per architecture: "Tagged errors with _tag field for pattern matching."

import { createErrorFactory } from '#/shared/domain/errors'
import type { InboxStatus } from './types'

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

export type InboxRevisionConflictResult = Readonly<{
  ok: false
  code: 'revision_conflict'
  currentCommandRevision: number
  currentStatus: InboxStatus
}>

const isInboxStatus = (value: unknown): value is InboxStatus =>
  value === 'open' || value === 'closed'

export const isInboxRevisionConflictResult = (
  value: unknown,
): value is InboxRevisionConflictResult => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<InboxRevisionConflictResult>
  return (
    candidate.ok === false &&
    candidate.code === 'revision_conflict' &&
    typeof candidate.currentCommandRevision === 'number' &&
    isInboxStatus(candidate.currentStatus)
  )
}

export const toInboxRevisionConflictResult = (
  error: InboxError,
): InboxRevisionConflictResult | null => {
  if (error.code !== 'revision_conflict') return null
  const currentCommandRevision = error.context?.currentCommandRevision
  const currentStatus = error.context?.currentStatus
  if (typeof currentCommandRevision !== 'number' || !isInboxStatus(currentStatus)) {
    return null
  }
  return {
    ok: false,
    code: 'revision_conflict',
    currentCommandRevision,
    currentStatus,
  }
}

export const REVISION_CONFLICT_MESSAGE = 'Inbox item changed; reload current state'

export const isInboxError = (e: unknown): e is InboxError =>
  typeof e === 'object' && e !== null && (e as InboxError)._tag === 'InboxError'
