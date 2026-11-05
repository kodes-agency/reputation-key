import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import { isPropertyError, type PropertyErrorCode } from '../domain/errors'

export const propertyErrorStatus = (code: PropertyErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with('property_not_found', () => HTTP_STATUS.NOT_FOUND)
    .with('slug_taken', 'revision_conflict', () => HTTP_STATUS.CONFLICT)
    .with('property_not_active', 'invalid_transition', () => HTTP_STATUS.CONFLICT)
    .with(
      'property_recovery_expired',
      'property_restore_not_ready',
      'google_binding_not_disconnectable',
      () => HTTP_STATUS.CONFLICT,
    )
    .with('stale_property', () => HTTP_STATUS.CONFLICT)
    .with(
      'invalid_slug',
      'invalid_name',
      'invalid_timezone',
      'invalid_country',
      'invalid_lifecycle_reason',
      'responsible_manager_ineligible',
      () => HTTP_STATUS.BAD_REQUEST,
    )
    .exhaustive()

export const propertyCommandErrors = {
  name: 'PropertyError',
  is: isPropertyError,
  status: propertyErrorStatus,
}
