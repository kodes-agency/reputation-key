// Property context — client-safe shared server utilities.
//
// Loaded by the client module graph (server-fn files import the status mapper
// from here). MUST NOT import server-only modules — the RPC transform strips
// handler-only direct imports but cannot strip module-level imports, so only
// client-safe symbols belong here. Server-only utilities (tracedHandler,
// getContainer, headersFromContext, ...) are imported directly by each
// server-fn file from their source.
//
// Extracted from properties.ts so properties.ts and property-read.ts share the
// error->HTTP mapping without forming a circular import.

import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import type { PropertyErrorCode } from '../domain/errors'

export const propertyErrorStatus = (code: PropertyErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with('property_not_found', () => HTTP_STATUS.NOT_FOUND)
    .with('slug_taken', () => HTTP_STATUS.CONFLICT)
    .with(
      'invalid_slug',
      'invalid_name',
      'invalid_timezone',
      () => HTTP_STATUS.BAD_REQUEST,
    )
    .exhaustive()
