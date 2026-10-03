// Portal context — how complete a Portal's configuration is, counted the way
// the Immersive Hub (snapshot schema version 3) reads it. A content review
// records the count as `portal.configuration_completeness.recorded`.
//
// Each field is something guests meet on the page, and each can be completed
// from the admin: the Portal's own fields in its editor, the Property's look,
// wording and Google connection by an Account Admin.
//
//  - `portal_name`: the Portal has a name.
//  - `primary_wording`: the primary language reads its own welcome line, link
//    preview and link labels: exactly what Review & publish's `primary_text`
//    check asks of the resolver. The welcome line and the link preview are the
//    Property's wording with the Portal's own lines over it, so a Portal line
//    with no Property wording behind it does not count (`hasPropertyWording`).
//    Another language with a gap is not missing: guests read the primary text
//    there.
//  - `property_look`: the Property has a Brand Profile, with a public display
//    name and an accent. Without one the page falls back to the default look.
//    A Property imported from Google starts with one (its confirmed name and
//    the default palette), and that counts: it is the look guests are shown.
//    A logo, a wordmark and a photograph are optional on the page, so here too.
//  - `linktree_link`: guests can open at least one link: the Linktree is on and
//    holds a link with an approved destination, as the guest page decides
//    whether to show the Linktree at all.
//  - `google_destination`: the Property's Google review destination is
//    verified, which Review & publish requires and the Google step needs.
//
// Like Review & publish, it reads the saved working copy: what the content
// review asks the manager to check, and what the next publication would show.
//
// The legacy count read the Portal name, `portals.description`, the Portal
// theme's colour, link categories and link addresses: settings a v3 page never
// shows, so a v3 Portal could not reach five of five. Facts counted that way
// carry the `legacy` field set and stay apart from these (reporting keeps them
// under their own metric version).
//
// Pure: the fact store reads the working copy under the Portal lock and passes
// it in with the Google answer the use case looked up.

import {
  resolvePortalPublication,
  type PortalPublicationSource,
} from './portal-publication-source'

export const PORTAL_CONFIGURATION_FIELDS = [
  'portal_name',
  'primary_wording',
  'property_look',
  'linktree_link',
  'google_destination',
] as const

export type PortalConfigurationField = (typeof PORTAL_CONFIGURATION_FIELDS)[number]

/**
 * Which fields a completeness fact counted: the Immersive Hub's five, or the
 * legacy five every fact recorded before them was counted on.
 */
export type PortalConfigurationFieldSet = 'legacy' | 'immersive_hub'

export type PortalConfigurationCompleteness = Readonly<{
  fieldSet: 'immersive_hub'
  /** The fields still to complete, in `PORTAL_CONFIGURATION_FIELDS` order. */
  missing: readonly PortalConfigurationField[]
  completedFields: number
  requiredFields: number
}>

const isWritten = (value: string): boolean => value.trim().length > 0

export function evaluatePortalConfigurationCompleteness(
  input: Readonly<{
    source: PortalPublicationSource
    googleReviewDestinationVerified: boolean
  }>,
): PortalConfigurationCompleteness {
  const { source } = input
  const { blockers } = resolvePortalPublication(source)
  const complete: Readonly<Record<PortalConfigurationField, boolean>> = {
    portal_name: isWritten(source.portal.name),
    primary_wording: !blockers.some((blocker) => blocker.code === 'primary_text_missing'),
    property_look:
      source.look !== null &&
      isWritten(source.look.displayName) &&
      isWritten(source.look.accentColour),
    linktree_link: source.linktreeEnabled && source.links.length > 0,
    google_destination: input.googleReviewDestinationVerified,
  }
  const missing = PORTAL_CONFIGURATION_FIELDS.filter((field) => !complete[field])
  return {
    fieldSet: 'immersive_hub',
    missing,
    completedFields: PORTAL_CONFIGURATION_FIELDS.length - missing.length,
    requiredFields: PORTAL_CONFIGURATION_FIELDS.length,
  }
}
