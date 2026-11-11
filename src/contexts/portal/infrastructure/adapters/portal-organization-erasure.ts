// The Portal tables an Organization or Property erasure deletes, in order. The
// rights executor runs the plan behind its journal entry.

/**
 * The explicit, static Portal purge plan, innermost dependency first.
 *
 * Deliberately NOT here:
 * - `portal_group_memberships`, `portal_responsibilities`, `team_*`: people
 *   and Staff rows whose data-fate owner is Staff, not Portal.
 * - `properties`: Property's row; Portal only references it.
 *
 * Nothing in this plan is ever a DROP or a TRUNCATE.
 *
 * `portal_look_overrides` (a Portal's own photo, colours and name and logo, ADR
 * 0070) refers to a Portal and to the Property's images, both ON DELETE
 * RESTRICT: it sits before `portal_media_assets` and `portals`, and needs no
 * presence root of its own, as it cannot exist without a Portal.
 */
export const PORTAL_PURGE_PLAN = Object.freeze([
  'portal_address_downloads',
  'portal_last_prints',
  'portal_print_wordings',
  'portal_access_artifacts',
  'portal_pending_content_changes',
  'portal_page_edits',
  'portal_publication_activations',
  'portal_publication_snapshots',
  'portal_health_intervals',
  'portal_link_texts',
  'portal_links',
  'portal_link_categories',
  'portal_approved_destinations',
  'portal_responsible_managers',
  'portal_tokens',
  'portal_localized_overrides',
  'portal_look_overrides',
  'property_portal_brand_contents',
  'property_portal_brand_profiles',
  'portal_media_assets',
  'portals',
  'portal_group_history',
  'portal_groups',
] as const)
