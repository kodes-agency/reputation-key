// Inbox context — client-safe shared utilities.
//
// This file is loaded by the client module graph (server-fn files import
// client-safe symbols like `createServerFn`, `can`, `inboxErrorStatus` from
// here). It MUST NOT import server-only modules — the RPC transform strips
// handler-only *direct* imports but cannot strip module-level imports in a
// barrel. Server-only utilities (tracedHandler, getContainer,
// headersFromContext, resolveTenantContext, throwContextError, catchUntagged)
// are imported directly by each server-fn file from their source instead.

import { createServerFn } from '@tanstack/react-start'
import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
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
  isInboxError,
  inboxErrorStatus,
  inboxItemId,
  propertyId,
  toUserId,
}
