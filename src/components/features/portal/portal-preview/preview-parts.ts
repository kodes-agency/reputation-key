// The parts of the guest page a manager can click to edit, and the editor
// section each one belongs to (board 02: "Click any part of the page to edit
// it"). Pure: which section a part opens, how a part is found on the drawn
// page, and which guest state draws it.
//
// Look and the two manager-only sections (Group, Responsible) have no part:
// they are not something the page shows.

import type { PortalEditorSection } from '../portal-editor/portal-editor-sections'
import type { PreviewStateId, PreviewStateOption } from './portal-preview-states'

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
  /** Whether the section that opens can be changed: a reader's parts say "open", not "edit". */
  canEdit: boolean
}>

/** What a part's button is called: "Edit Welcome", or "Open Welcome" where the section is read-only. */
export function partActionName(canEdit: boolean, label: string): string {
  return `${canEdit ? 'Edit' : 'Open'} ${label}`
}

/** Board 02's line under the phone. */
export function selectionHint(canEdit: boolean): string {
  return canEdit
    ? 'Click any part of the page to edit it'
    : 'Click any part of the page to see its settings'
}

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
 *
 * The "Your response" disclosure under the receipt (`.ih-yr`) is in no part, on
 * purpose: it shows the guest's own answer, which no section sets, and adding
 * it to the rating would stretch that part over the private note below it.
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

/** Whether a state draws the private note: after a rating, when it is offered or was sent. */
const drawsNote = (option: PreviewStateOption): boolean =>
  option.state.phase === 'rated' && option.state.note !== 'none'

/**
 * The guest state to show once `part` is the one being edited: the one the
 * manager is on when it draws the part, else the first that does. Only the
 * private note is missing from some states, and which ones depends on the
 * threshold, so `options` are the states the filmstrip offers.
 */
export function stateIdForPart(
  part: PreviewPartSection | null,
  current: PreviewStateId,
  options: readonly PreviewStateOption[],
): PreviewStateId {
  if (part !== 'private-note') return current
  const shown = options.find((option) => option.id === current)
  if (shown !== undefined && drawsNote(shown)) return current
  return options.find(drawsNote)?.id ?? current
}
