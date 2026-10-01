// The parts of the guest page a manager can click to edit, and the editor
// section each one belongs to (board 02: "Click any part of the page to edit
// it"). Pure: which section a part opens, how a part is found on the drawn
// page, and which guest state draws it.
//
// Look and the two manager-only sections (Group, Responsible) have no part:
// they are not something the page shows.

import type { PortalEditorSection } from '../portal-editor/portal-editor-sections'
import type { PreviewStateId } from './portal-preview-states'

export const PREVIEW_PART_SECTIONS = [
  'welcome',
  'rating',
  'private-note',
  'linktree',
  'footer',
  'languages',
] as const satisfies ReadonlyArray<PortalEditorSection>

/** A section of the editor that has a part on the page: the part and the section share a name. */
export type PreviewPartSection = (typeof PREVIEW_PART_SECTIONS)[number]

/** What the preview needs to make its parts selectable. */
export type PreviewSelection = Readonly<{
  /** The editor's active section: the part that belongs to it is outlined. */
  active: PortalEditorSection
  /** A part was chosen with a click or Enter: the editor opens its section. */
  onSelect: (section: PreviewPartSection) => void
}>

export function previewPartOf(
  section: PortalEditorSection | undefined,
): PreviewPartSection | null {
  return PREVIEW_PART_SECTIONS.find((part) => part === section) ?? null
}

/**
 * How each part is found on the drawn page. A part is the union of everything
 * the first selector that matches finds: the rating card and, after a rating,
 * the receipt and the Google card are one part ("Rating & Google"). The
 * language chip is the part until the sheet is open, and then the sheet is.
 * The markers are the page's own classes and the two `data-preview-part`
 * attributes the preview adds; `preview-guest-page.test.ts` pins each one.
 */
export const PREVIEW_PART_SELECTORS: Readonly<
  Record<PreviewPartSection, readonly string[]>
> = {
  welcome: ['.ih-title'],
  rating: ['.ih-rating-card, .ih-receipt, .ih-google-card'],
  'private-note': ['.ih-note'],
  linktree: ['[data-preview-part="linktree"]'],
  footer: ['.ih-footer'],
  languages: ['[data-preview-part="language-sheet"]', '.ih-chip'],
}

/** The states of the filmstrip that draw the private note: after a low rating, and once it is sent. */
const STATES_WITH_NOTE: ReadonlySet<PreviewStateId> = new Set(['low', 'done'])

/**
 * The guest state to show once `part` is the one being edited: the one the
 * manager is on when it draws the part, else the first that does. Only the
 * private note is missing from some states, and a guest meets it after a low rating.
 */
export function stateIdForPart(
  part: PreviewPartSection | null,
  current: PreviewStateId,
): PreviewStateId {
  if (part !== 'private-note' || STATES_WITH_NOTE.has(current)) return current
  return 'low'
}
