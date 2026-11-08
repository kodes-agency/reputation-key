import { match } from 'ts-pattern'
import type { CommandErrors } from '#/shared/commands/contracts'
import { isPortalError, type PortalError, type PortalErrorCode } from '../domain/errors'

export const portalErrorStatus = (code: PortalErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with(
      'portal_not_found',
      'property_not_found',
      'category_not_found',
      'link_not_found',
      'destination_not_found',
      'media_not_found',
      () => 404,
    )
    .with(
      'slug_taken',
      'revision_conflict',
      'running_rating_goal',
      'goal_needs_collector',
      'print_code_collision',
      'destination_not_approved',
      'link_limit_reached',
      'brand_profile_missing',
      'personal_portal_name_private',
      'personal_portal_goal_locked',
      () => 409,
    )
    .with(
      'upload_failed',
      'image_rejected',
      'print_code_too_small',
      'token_unavailable',
      'address_unavailable',
      'responsible_manager_ineligible',
      () => 422,
    )
    .with('group_not_found', 'portal_not_in_group', () => 404)
    .with('group_name_taken', 'portal_already_grouped', () => 409)
    .with(
      'personal_portal_rename_locked',
      'personal_portal_archive_locked',
      'personal_portal_restore_locked',
      'source_has_unpublished_changes',
      'source_archived',
      'address_keyring_missing',
      () => 409,
    )
    .with('portal_inactive', () => 410)
    .with('rate_limited', () => 429)
    .with(
      'invalid_publication_transition',
      'publication_snapshot_unavailable',
      'not_restorable',
      'guest_wording_missing',
      'language_pack_missing',
      'time_zone_invalid',
      'google_review_destination_unavailable',
      () => 409,
    )
    .with(
      'invalid_slug',
      'invalid_name',
      'invalid_description',
      'invalid_theme',
      'invalid_threshold',
      'invalid_skip_private_rating',
      'invalid_url',
      'invalid_label',
      'invalid_icon',
      'invalid_title',
      'locale_not_offered',
      'print_format_not_offered',
      () => 400,
    )
    .exhaustive()

export const portalCommandErrors: CommandErrors<PortalError> = {
  name: 'PortalError',
  is: isPortalError,
  status: portalErrorStatus,
}
