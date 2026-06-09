// Inbox context — shared server utilities

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import { getContainer } from '#/composition'
import { can } from '#/shared/domain/permissions'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { isInboxError } from '../domain/errors'
import type { InboxErrorCode } from '../domain/errors'
import { inboxItemId, propertyId } from '#/shared/domain/ids'
import { userId as toUserId } from '#/shared/domain/ids'

// ── Error → HTTP status mapping (exhaustive) ──────────────────────

const inboxErrorStatus = (code: InboxErrorCode): number =>
  match(code)
    .with(
      'invalid_transition',
      'invalid_input',
      'assignment_not_allowed',
      () => HTTP_STATUS.BAD_REQUEST,
    )
    .with('not_found', () => HTTP_STATUS.NOT_FOUND)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with('already_exists', () => HTTP_STATUS.CONFLICT)
    .with('bulk_partial_failure', () => HTTP_STATUS.MULTI_STATUS)
    .exhaustive()

export {
  createServerFn,
  tracedHandler,
  headersFromContext,
  resolveTenantContext,
  throwContextError,
  catchUntagged,
  can,
  getContainer,
  isInboxError,
  inboxErrorStatus,
  inboxItemId,
  propertyId,
  toUserId,
}
