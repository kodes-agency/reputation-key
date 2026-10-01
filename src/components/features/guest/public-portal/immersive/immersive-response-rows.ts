import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { guestLocaleFormatTag } from '#/shared/domain/guest-locale'
import { formatGuestDeadline } from '../guest-deadline-format'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'

/**
 * The one clock the section reads. `now` travels with the page data and
 * `timeZone` is the portal's own, so the server and the browser print the same
 * deadline text (React #418); neither side reads its own clock or zone.
 */
export type ResponseClock = Readonly<{ now: string; timeZone: string }>

export type ResponseRowId = 'change' | 'remove-note' | 'remove-all'

export type ResponseRow = Readonly<{
  id: ResponseRowId
  title: string
  /** The deadline sentence, or that the time has ended. Empty when there is nothing to say. */
  detail: string
  /** The window is open: the row offers its button. */
  actionable: boolean
  /** The button's visible text. */
  actionLabel: string
  /** The button's accessible name: what it changes, which "Change" alone does not say. */
  actionName: string
}>

type Window = Readonly<{
  deadline: string | null
  available: boolean
  endedText: string
}>

function deadlineText(
  pack: GuestPortalCopyV2,
  clock: ResponseClock,
  window: Window,
): string {
  if (!window.available) return window.endedText
  if (window.deadline === null) return ''
  return formatGuestDeadline(
    pack,
    window.deadline,
    clock.now,
    clock.timeZone,
    guestLocaleFormatTag(pack.locale),
  )
}

/**
 * The rows of "Your response" (board G07) for a rated response: change the
 * rating, remove the note (only when one was sent) and remove the rating and
 * the note. Each window is the server's, so a row runs out of time on its own.
 * The sentence for a later day is joined by the pack, never by the engine.
 */
export function responseSectionRows(
  pack: GuestPortalCopyV2,
  response: GuestResponseView,
  clock: ResponseClock,
): readonly ResponseRow[] {
  const { copy } = pack
  const change: Window = {
    deadline: response.correctionDeadline,
    available: response.correctionAvailable,
    endedText: copy.windowEndedChange,
  }
  const note: Window = {
    deadline: response.feedbackWithdrawalDeadline,
    available: response.feedbackWithdrawalAvailable,
    endedText: copy.windowEndedNote,
  }
  const all: Window = {
    deadline: response.responseWithdrawalDeadline,
    available: response.responseWithdrawalAvailable,
    endedText: copy.windowEndedAll,
  }
  const allDeadline = deadlineText(pack, clock, all)
  const rows: ResponseRow[] = [
    {
      id: 'change',
      title: copy.responseChangeTitle,
      detail: deadlineText(pack, clock, change),
      actionable: change.available,
      actionLabel: copy.ratingChange,
      actionName: copy.responseChangeTitle,
    },
  ]
  if (response.hasPrivateFeedback) {
    rows.push({
      id: 'remove-note',
      title: copy.responseRemoveNoteTitle,
      detail: deadlineText(pack, clock, note),
      actionable: note.available,
      actionLabel: copy.responseRemoveNoteAction,
      actionName: copy.responseRemoveNoteTitle,
    })
  }
  rows.push({
    id: 'remove-all',
    title: copy.responseRemoveAllTitle,
    // The note about Google belongs to the open window: once it has ended
    // there is nothing left to remove, and so nothing left to reassure about.
    detail:
      all.available && allDeadline !== ''
        ? `${allDeadline}. ${copy.responseRemoveAllNote}`
        : allDeadline,
    actionable: all.available,
    actionLabel: copy.responseRemoveAllAction,
    actionName: copy.responseRemoveAllTitle,
  })
  return rows
}
