import type { PortalListItem } from './portal-list-types'

/**
 * How a portal's publication state presents in the list: its human label and
 * its badge variant. Both are `Record`s over the REAL domain union rather than
 * expressions, so adding a state to the domain fails to compile here instead of
 * rendering the raw identifier (the old `state[0].toUpperCase() + state.slice(1)`)
 * or silently falling into the `outline` arm of a ternary.
 *
 * Kept free of JSX so the two rules are readable — and testable — on their own.
 */
export type PublicationState = PortalListItem['publicationState']

export const PUBLICATION_LABELS: Record<PublicationState, string> = {
  draft: 'Draft',
  published: 'Published',
  disabled: 'Disabled',
  archived: 'Archived',
}

/**
 * Only a published portal earns the filled (`default`) badge; every other
 * state — including the two that merely *used* to be public, `disabled` and
 * `archived` — is outlined. Narrowed to the two variants this list uses so a
 * typo cannot resolve to some other `Badge` variant.
 */
export const PUBLICATION_BADGE_VARIANTS: Record<PublicationState, 'default' | 'outline'> =
  {
    draft: 'outline',
    published: 'default',
    disabled: 'outline',
    archived: 'outline',
  }
