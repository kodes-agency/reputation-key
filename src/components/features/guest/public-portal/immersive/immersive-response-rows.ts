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

/** What the guest is asked before "Remove…" goes through. */
export type ResponseConfirmation = Readonly<{
  title: string
  body: string
  confirm: string
  cancel: string
}>

export type ResponseRow = Readonly<{
  id: ResponseRowId
  title: string
  /** The deadline sentence, or that the time has ended. Empty when there is nothing to say. */
  detail: string
  /** A sentence of its own under the deadline, or empty. The pack writes it; the engine joins nothing. */
  note: string
  /** The window is open: the row offers its button. */
  actionable: boolean
  /** The button's visible text. Its accessible name is this plus the row's title. */
  actionLabel: string
  /** The question the button asks first, for the row that cannot be undone. */
  confirmation: ResponseConfirmation | null
}>

type Window = Readonly<{
  deadline: string | null
  available: boolean
  endedText: string
}>

/**
 * Where a window stands. `closed` is a window the server shut with time still on
 * the clock (the change was used, or moderation took over): saying the time has
 * ended would be false, and there is nothing to offer, so the row is left out.
 */
function windowState(clock: ResponseClock, window: Window): 'open' | 'ended' | 'closed' {
  if (window.available) return 'open'
  if (window.deadline === null) return 'ended'
  return Date.parse(window.deadline) > Date.parse(clock.now) ? 'closed' : 'ended'
}

function deadlineText(
  pack: GuestPortalCopyV2,
  clock: ResponseClock,
  window: Window,
  state: 'open' | 'ended',
): string {
  if (state === 'ended') return window.endedText
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
 * rating, remove the note (only when one was sent) and remove the rating, with
 * the note when there is one. Each window is the server's, so a row runs out of
 * time on its own. The sentences are the pack's, each whole; the engine joins
 * none of them.
 */
export function responseSectionRows(
  pack: GuestPortalCopyV2,
  response: GuestResponseView,
  clock: ResponseClock,
): readonly ResponseRow[] {
  const { copy } = pack
  const windows = {
    change: {
      deadline: response.correctionDeadline,
      available: response.correctionAvailable,
      endedText: copy.windowEndedChange,
    },
    note: {
      deadline: response.feedbackWithdrawalDeadline,
      available: response.feedbackWithdrawalAvailable,
      endedText: copy.windowEndedNote,
    },
    all: {
      deadline: response.responseWithdrawalDeadline,
      available: response.responseWithdrawalAvailable,
      endedText: copy.windowEndedAll,
    },
  } satisfies Record<string, Window>
  const withNote = response.hasPrivateFeedback
  const rows: Array<ResponseRow | null> = [
    row('change', pack, clock, windows.change, {
      title: copy.responseChangeTitle,
      actionLabel: copy.ratingChange,
    }),
    withNote
      ? row('remove-note', pack, clock, windows.note, {
          title: copy.responseRemoveNoteTitle,
          actionLabel: copy.responseRemoveNoteAction,
        })
      : null,
    row('remove-all', pack, clock, windows.all, {
      title: withNote ? copy.responseRemoveAllTitle : copy.responseRemoveRatingTitle,
      actionLabel: copy.responseRemoveAllAction,
      // The note about Google belongs to the open window: once it has ended
      // there is nothing left to remove, and so nothing left to reassure about.
      openNote: copy.responseRemoveAllNote,
      confirmation: withNote
        ? {
            title: copy.responseRemoveAllConfirmTitle,
            body: copy.responseRemoveAllConfirmBody,
            confirm: copy.responseRemoveAllConfirm,
            cancel: copy.responseRemoveAllCancel,
          }
        : {
            title: copy.responseRemoveRatingConfirmTitle,
            body: copy.responseRemoveRatingConfirmBody,
            confirm: copy.responseRemoveRatingConfirm,
            cancel: copy.responseRemoveRatingCancel,
          },
    }),
  ]
  return rows.filter((entry): entry is ResponseRow => entry !== null)
}

function row(
  id: ResponseRowId,
  pack: GuestPortalCopyV2,
  clock: ResponseClock,
  window: Window,
  words: Readonly<{
    title: string
    actionLabel: string
    openNote?: string
    confirmation?: ResponseConfirmation
  }>,
): ResponseRow | null {
  const state = windowState(clock, window)
  if (state === 'closed') return null
  const detail = deadlineText(pack, clock, window, state)
  return {
    id,
    title: words.title,
    detail,
    note: state === 'open' && detail !== '' ? (words.openNote ?? '') : '',
    actionable: state === 'open',
    actionLabel: words.actionLabel,
    confirmation: words.confirmation ?? null,
  }
}
