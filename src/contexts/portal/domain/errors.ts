// Portal context — domain errors
// Per architecture: tagged error shape with _tag, code, message.
// Error codes form a closed union so ts-pattern .exhaustive() works at the server boundary.

import { createErrorFactory } from '#/shared/domain/errors'

export type PortalErrorCode =
  | 'forbidden'
  | 'personal_portal_name_private'
  | 'personal_portal_goal_locked'
  | 'personal_portal_rename_locked'
  | 'personal_portal_archive_locked'
  | 'personal_portal_restore_locked'
  | 'source_has_unpublished_changes'
  | 'source_archived'
  | 'address_keyring_missing'
  | 'invalid_slug'
  | 'invalid_name'
  | 'invalid_description'
  | 'invalid_theme'
  | 'invalid_threshold'
  | 'invalid_skip_private_rating'
  | 'running_rating_goal'
  | 'invalid_url'
  | 'invalid_label'
  | 'invalid_icon'
  | 'invalid_title'
  | 'slug_taken'
  | 'portal_not_found'
  | 'category_not_found'
  | 'link_not_found'
  | 'link_limit_reached'
  | 'locale_not_offered'
  | 'destination_not_found'
  | 'destination_not_approved'
  | 'property_not_found'
  | 'brand_profile_missing'
  | 'group_not_found'
  | 'group_name_taken'
  | 'portal_already_grouped'
  | 'portal_not_in_group'
  | 'portal_inactive'
  | 'invalid_publication_transition'
  | 'publication_snapshot_unavailable'
  | 'google_review_destination_unavailable'
  | 'token_unavailable'
  | 'address_unavailable'
  | 'rate_limited'
  | 'upload_failed'
  | 'image_rejected'
  | 'media_not_found'
  | 'print_format_not_offered'
  | 'print_code_too_small'
  | 'print_code_collision'
  | 'responsible_manager_ineligible'
  | 'revision_conflict'
  /** A capability that is switched off on this deployment (e.g. PORTAL_OWN_LOOK_ENABLED). */
  | 'feature_unavailable'

export type PortalError = Readonly<{
  _tag: 'PortalError'
  code: PortalErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

/** Smart constructor — the only way to build a PortalError. */
export const portalError = createErrorFactory<PortalError['_tag'], PortalError['code']>(
  'PortalError',
)

/** Type guard — lets server functions detect PortalError at catch time. */
export const isPortalError = (e: unknown): e is PortalError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'PortalError'
