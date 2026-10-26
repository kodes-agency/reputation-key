// Which surface a portal's Look section shows (the editor, the facts, or today's
// summary) and the words that go with each. Pure, so the rules and the wording are
// pinned by tests, and light, so the section can decide without the editor's code,
// which is fetched only when the editor is shown.

import type { PortalLookSources } from '#/contexts/portal/application/public-api'

export type PortalLookSurface = 'editor' | 'facts' | 'summary'

/** A property with fewer portals than this has no use for a look of a portal's own. */
const PORTALS_FOR_OWN_LOOK = 2

/** Whether the portal owns any of the three groups (a photo taken away counts). */
export function hasOwnLook(sources: PortalLookSources): boolean {
  return (
    sources.photo !== 'property' ||
    sources.colours !== 'property' ||
    sources.identity !== 'property'
  )
}

export type PortalLookSurfaceInput = Readonly<{
  /** PORTAL_OWN_LOOK_ENABLED: whether a portal's own look may be changed at all. */
  enabled: boolean
  /** An Account Admin who may write portals, on a portal that is not archived. */
  canChange: boolean
  /** The property's portals that are not archived, this one included. */
  siblingPortalCount: number
  sources: PortalLookSources
}>

/**
 * The editor appears only while it is of use: the switch is on, the viewer may
 * change the look, and the property has a second portal, or this one already has
 * a look of its own (so it can still be given back after the others are archived).
 * Anyone else sees the facts once there is something to tell; a property with one
 * portal and no override sees today's summary, as if nothing had been built.
 */
export function portalLookSurfaceOf(input: PortalLookSurfaceInput): PortalLookSurface {
  const hasOwn = hasOwnLook(input.sources)
  const hasSiblings = input.siblingPortalCount >= PORTALS_FOR_OWN_LOOK
  if (input.enabled && input.canChange && (hasSiblings || hasOwn)) return 'editor'
  if (hasOwn || (input.enabled && hasSiblings)) return 'facts'
  return 'summary'
}

// ── The words ────────────────────────────────────────────────────────────────

export const SUMMARY_DESCRIPTION =
  'The photo, colours and name guests see on this portal.'

export const FACTS_NOTE = 'An account admin changes this portal’s look.'

/**
 * Who can change the look, under the facts. An archived portal keeps the look
 * it had, and while the switch is off nobody can change it, so neither points
 * to an Account Admin who could not act on it.
 */
export function lookFactsNoteOf(
  input: Readonly<{ enabled: boolean; archived: boolean }>,
): string {
  if (input.archived) return 'An archived portal keeps the look it had.'
  if (!input.enabled) return 'A portal’s own look cannot be changed at the moment.'
  return FACTS_NOTE
}

const OWN = 'This portal’s own'
const PROPERTY = 'The property’s'

export type LookFact = Readonly<{ term: string; value: string }>

/** What the portal takes from the property and what it owns, for someone who may not change it. */
export function lookFactsOf(sources: PortalLookSources): readonly LookFact[] {
  const photo =
    sources.photo === 'portal'
      ? OWN
      : sources.photo === 'none'
        ? 'None on this portal'
        : PROPERTY
  return [
    { term: 'Photo', value: photo },
    { term: 'Colours', value: sources.colours === 'portal' ? OWN : PROPERTY },
    { term: 'Name and logo', value: sources.identity === 'portal' ? OWN : PROPERTY },
  ]
}

/**
 * The line under the section's name, in two parts with the words that link to
 * the property look between them.
 */
export function lookIntroOf(
  portalName: string,
  sources: PortalLookSources,
): Readonly<{ before: string; after: string }> {
  const drafts = `Changes are drafts until you publish ${portalName}.`
  return hasOwnLook(sources)
    ? {
        before: `${portalName} follows `,
        after: ` except for what is set here. ${drafts}`,
      }
    : {
        before: `${portalName} uses `,
        after: `. Give it its own photo, colours, or name and logo. ${drafts}`,
      }
}
