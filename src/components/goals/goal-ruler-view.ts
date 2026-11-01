// The goal ruler, laid out (pure, 2026-11-01): a goal hands in its numbers and
// words, and this decides what fits. Where the goal stands is clamped to the
// ruler. A stop's words are drawn only where they cannot run into the two ends;
// the "now" label stays inside the ruler at both ends. Each goal's own numbers
// are worked out in its own view (`rating-goal-ruler-view.ts`,
// `portal-goal-ruler-view.ts`), and no goal's words live here.

export type GoalRulerEnd = Readonly<{ value: string; note: string | null }>

export type GoalRulerStop = Readonly<{
  key: string
  /** Where on the ruler, as a share from 0 to 1. */
  at: number
  /** Its figure; null draws the stop with no words, where they would not fit. */
  value: string | null
  note: string | null
  reached: boolean
  /** Centred under the stop, or ending at it near the ruler's right end. */
  align: 'center' | 'end'
}>

export type GoalRulerModel = Readonly<{
  /** The picture's one sentence. */
  label: string
  from: Readonly<{ value: string; note: string }>
  to: GoalRulerEnd
  /** The end's note leaves a narrow ruler, where a stop's words reach it. */
  toNoteWideOnly: boolean
  /** Where the goal stands, as a share from 0 to 1. */
  at: number
  /** The label above it: "Today", "23 so far". */
  now: string
  nowAlign: 'start' | 'center' | 'end'
  /** The start has its own dot once the goal has moved off it. */
  startDot: boolean
  stops: readonly GoalRulerStop[]
  reached: boolean
}>

export const clampShare = (share: number): number =>
  Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0

/** "Today" would run off the ruler this close to either end. */
const NOW_EDGE = 0.07
/** A stop's words run into the start's, or the end's, this close to them. */
const STOP_EDGE_START = 0.14
const STOP_EDGE_END = 0.8
/** Past the centred stop's reach its words end at it; past this they do not fit at all. */
const STOP_LAST = 0.93
/** On a phone's ruler a stop's words reach the end's note from here on. */
const STOP_REACHES_NOTE = 0.55

type StopInput = Readonly<{
  key: string
  at: number
  value: string
  note: string | null
}>

function stopOf(stop: StopInput, at: number): GoalRulerStop {
  const share = clampShare(stop.at)
  const fits = share >= STOP_EDGE_START && share <= STOP_LAST
  return {
    key: stop.key,
    at: share,
    value: fits ? stop.value : null,
    note: fits ? stop.note : null,
    reached: share <= at,
    align: share > STOP_EDGE_END ? 'end' : 'center',
  }
}

export function rulerModel(input: {
  label: string
  from: Readonly<{ value: string; note: string }>
  to: GoalRulerEnd
  at: number
  now: string
  stops: readonly StopInput[]
  reached?: boolean
}): GoalRulerModel {
  const at = clampShare(input.at)
  const stops = input.stops.map((stop) => stopOf(stop, at))
  // A stop's words past the centred reach leave no room for the end's note.
  const crowded = stops.some((stop) => stop.value !== null && stop.at > STOP_EDGE_END)
  return {
    label: input.label,
    from: input.from,
    to: crowded ? { value: input.to.value, note: null } : input.to,
    toNoteWideOnly: stops.some(
      (stop) => stop.value !== null && stop.at >= STOP_REACHES_NOTE,
    ),
    at,
    now: input.now,
    nowAlign: at < NOW_EDGE ? 'start' : at > 1 - NOW_EDGE ? 'end' : 'center',
    startDot: at >= NOW_EDGE,
    stops,
    reached: input.reached === true,
  }
}
