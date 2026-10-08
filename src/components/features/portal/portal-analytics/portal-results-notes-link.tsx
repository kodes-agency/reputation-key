// The Private notes cell's way to the notes themselves. The Inbox has no filter
// for one portal, so the link opens the Property's private-notes queue: it says
// where the notes are read, not how many of them are this portal's.
import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { InlineLink } from '#/components/ui/inline-link'
import { INBOX_WAITING_QUEUE } from '../portal-overview/portal-overview-inbox'
import type { ResultsCell } from './portal-results-cells'
import type { PortalResultsPlace } from './portal-results-place'

/**
 * The cell's own line (the change) with the link under it, or nothing to
 * replace it with: no link for a reader who cannot open the Inbox, or while
 * there are no notes to read.
 */
export function notesDetailOf(
  cells: readonly ResultsCell[],
  place: PortalResultsPlace | undefined,
): ReactNode {
  const notes = cells.find((cell) => cell.key === 'notes')
  if (place === undefined || !place.canOpenInbox || notes === undefined) return undefined
  if (notes.value === '0' || notes.value === '—') return undefined
  return (
    <span className="flex flex-col items-start gap-0.5">
      {notes.detail === null ? null : <span>{notes.detail}</span>}
      <InlineLink
        to="/inbox"
        search={{ propertyId: place.propertyId, queue: INBOX_WAITING_QUEUE }}
        // The padding only grows the touch target; the line keeps its place.
        className="-my-1.5 inline-flex items-center gap-1 rounded-sm py-1.5 text-xs leading-4"
      >
        Read in inbox
        <ArrowRight className="size-3" aria-hidden="true" />
      </InlineLink>
    </span>
  )
}
