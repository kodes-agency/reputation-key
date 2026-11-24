// Inbox context — the error → HTTP status mapping the server functions share.

import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import type { InboxErrorCode } from '../domain/inbox-errors'

export const inboxErrorStatus = (code: InboxErrorCode): number =>
  match(code)
    .with(
      'invalid_transition',
      'invalid_input',
      'assignment_not_allowed',
      () => HTTP_STATUS.BAD_REQUEST,
    )
    .with('not_found', () => HTTP_STATUS.NOT_FOUND)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with(
      'already_exists',
      'revision_conflict',
      'priority_changed',
      () => HTTP_STATUS.CONFLICT,
    )
    .with('bulk_partial_failure', () => HTTP_STATUS.MULTI_STATUS)
    .exhaustive()
