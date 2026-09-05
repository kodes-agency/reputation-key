// Staff context — client-safe shared server utilities.
//
// Loaded by the client module graph (server-fn files import the status mapper
// from here). MUST NOT import server-only modules — the RPC transform strips
// handler-only direct imports but cannot strip module-level imports, so only
// client-safe symbols belong here. Server-only utilities (tracedHandler,
// getContainer, headersFromContext, ...) are imported directly by each
// server-fn file from their source.

import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import type { StaffErrorCode } from '../domain/errors'

export const staffErrorStatus = (code: StaffErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with('participation_not_found', 'property_not_found', () => HTTP_STATUS.NOT_FOUND)
    .with(
      'participation_archived',
      'responsibility_conflict',
      'revision_conflict',
      () => HTTP_STATUS.CONFLICT,
    )
    .with('invalid_input', () => HTTP_STATUS.BAD_REQUEST)
    .exhaustive()
