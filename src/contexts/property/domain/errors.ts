// Property context — domain errors
// Per architecture: tagged error shape with _tag, code, message.
// Error codes form a closed union so ts-pattern .exhaustive() works at the server boundary.

import { createErrorFactory } from '#/shared/domain/errors'

export const PROPERTY_DELETION_UNAVAILABLE_MESSAGE =
  'Permanent property removal is not available in this beta.'

export type PropertyErrorCode =
  | 'forbidden'
  | 'invalid_slug'
  | 'invalid_name'
  | 'invalid_timezone'
  | 'invalid_country'
  | 'invalid_lifecycle_reason'
  | 'property_recovery_expired'
  | 'property_restore_not_ready'
  | 'google_binding_not_disconnectable'
  | 'region_unresolved'
  | 'slug_taken'
  | 'property_not_found'
  | 'invalid_transition'
  | 'property_not_active'
  | 'stale_property'
  | 'responsible_manager_ineligible'
  | 'revision_conflict'

export type PropertyError = Readonly<{
  _tag: 'PropertyError'
  code: PropertyErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

/** Smart constructor — the only way to build a PropertyError. */
export const propertyError = createErrorFactory<
  PropertyError['_tag'],
  PropertyError['code']
>('PropertyError')

/** Type guard — lets server functions detect PropertyError at catch time. */
export const isPropertyError = (e: unknown): e is PropertyError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'PropertyError'
