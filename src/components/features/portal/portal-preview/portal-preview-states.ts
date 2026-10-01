// The guest page states the preview can show, and the small state machine
// behind "Try as guest". Pure: no React, no server. The static states are
// what the filmstrip draws; the machine moves between the same states when a
// manager clicks through the page, and writes nothing anywhere.

import type { PortalPreviewSource } from '#/contexts/portal/application/public-api'

/** Where a guest's private note stands after a rating. */
export type PreviewNoteState = 'none' | 'offered' | 'writing' | 'sent'

export type PreviewPageState =
  /** Before a rating. `selected` is the star chosen but not yet sent. */
  | Readonly<{ phase: 'arrival'; selected: number | null }>
  /** After a rating was sent: the receipt, the Google card, and maybe the note. */
  | Readonly<{ phase: 'rated'; rating: number; note: PreviewNoteState }>

export const ARRIVAL_STATE: PreviewPageState = Object.freeze({
  phase: 'arrival',
  selected: null,
})

/** The page after `rating` is sent: the note is offered at or below the threshold. */
export function ratedState(rating: number, threshold: number): PreviewPageState {
  return { phase: 'rated', rating, note: rating <= threshold ? 'offered' : 'none' }
}

export type PreviewStateId = 'arrival' | 'low' | 'high' | 'done'

export type PreviewStateOption = Readonly<{
  id: PreviewStateId
  /** What the filmstrip prints under the thumbnail. */
  label: string
  /** What a screen reader hears. */
  name: string
  state: PreviewPageState
}>

const LOW_RATING = 2
const HIGH_RATING = 5

/**
 * The filmstrip: arrival, after a low rating (the note is offered), after a high
 * one (it is not), and the note sent. A low rating is 2 stars as on the board,
 * or the threshold itself when that is lower; with no rating offered a note
 * there is no low rating to show.
 */
export function previewStateOptions(threshold: number): readonly PreviewStateOption[] {
  const arrival: PreviewStateOption = {
    id: 'arrival',
    label: 'Arrival',
    name: 'Arrival',
    state: ARRIVAL_STATE,
  }
  const high: PreviewStateOption = {
    id: 'high',
    label: `After ${HIGH_RATING}★`,
    name: `After a ${HIGH_RATING} star rating`,
    state: ratedState(HIGH_RATING, threshold),
  }
  const low = Math.min(LOW_RATING, threshold)
  if (low < 1) return [arrival, high]
  return [
    arrival,
    {
      id: 'low',
      label: `After ${low}★`,
      name: `After a ${low} star rating`,
      state: ratedState(low, threshold),
    },
    high,
    {
      id: 'done',
      label: 'Done',
      name: 'After the private note is sent',
      state: { phase: 'rated', rating: low, note: 'sent' },
    },
  ]
}

const SOURCE_NAME: Readonly<Record<PortalPreviewSource, string>> = {
  draft: 'Draft',
  live: 'Live',
}

/** The line over the phone: "Draft · Arrival · English". */
export function stateCaption(
  source: PortalPreviewSource,
  stateLabel: string,
  languageName: string,
): string {
  return `${SOURCE_NAME[source]} · ${stateLabel} · ${languageName}`
}

export type TryAsGuestAction =
  | Readonly<{ type: 'choose'; rating: number }>
  | Readonly<{ type: 'send' }>
  | Readonly<{ type: 'writeNote' }>
  | Readonly<{ type: 'sendNote' }>
  | Readonly<{ type: 'change' }>
  | Readonly<{ type: 'restart' }>

/** One step of a guest's visit, played locally. Anything that does not apply changes nothing. */
export function tryAsGuestReducer(
  state: PreviewPageState,
  action: TryAsGuestAction,
  threshold: number,
): PreviewPageState {
  switch (action.type) {
    case 'choose':
      return { phase: 'arrival', selected: action.rating }
    case 'send':
      return state.phase === 'arrival' && state.selected !== null
        ? ratedState(state.selected, threshold)
        : state
    case 'writeNote':
      return state.phase === 'rated' && state.note === 'offered'
        ? { ...state, note: 'writing' }
        : state
    case 'sendNote':
      return state.phase === 'rated' && state.note === 'writing'
        ? { ...state, note: 'sent' }
        : state
    case 'change':
      return state.phase === 'rated'
        ? { phase: 'arrival', selected: state.rating }
        : state
    case 'restart':
      return ARRIVAL_STATE
  }
}
