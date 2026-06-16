// Property context — error → HTTP status mapping.
// Extracted into its own module so the server function files can share it
// without forming a circular import (properties.ts ↔ property-read.ts).

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
