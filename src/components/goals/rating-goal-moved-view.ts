// "What moved you" on the Google rating goal's detail page (round 5, PLAN-D
// D-2, mock D3), worked out (pure): this week's new reviews first, then each
// day Google's own number moved and each change of the plan, newest first, and
// the day the goal was set, always last. Past events keep their short dates
// (E21); only arrivals are durations. The rows carry no per-review value: the
// stars of this week's reviews and the low reviews come with the owner's
// exception (PLAN-D D-2b, Q2).
import type {
  RatingGoalChangeView,
  RatingGoalDetailView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { formatNumber, formatShortDate } from '#/lib/format'
import { paceText } from './rating-goal-pace-words'
import { changeText, tenthsText } from './rating-goal-view'

/** The list shows this many rows at most, the set's row among them. */
const MAX_ROWS = 12

export type MovedRow = Readonly<{
  key: string
  /** "This week", or the event's short date. */
  when: string
  text: string
  /** Google's number up (positive ink) or down (warn ink); none for the rest. */
  tone: 'positive' | 'warn' | null
}>

export type MovedContext = Readonly<{
  /** The person's name once the members are read; null until then, or for a former member. */
  personName: (userId: string) => string | null
  timezone: string
  now: Date
}>

type Dated = Readonly<{ at: string; row: MovedRow }>

const nameOf = (userId: string, context: MovedContext): string =>
  context.personName(userId) ?? 'A manager'

const dayOf = (at: string, context: MovedContext): string =>
  formatShortDate(at, context.timezone, context.now) ?? ''

/** "No new reviews yet", "1 new review", "3 new reviews". */
export function thisWeekText(count: number): string {
  if (count === 0) return 'No new reviews yet'
  return `${formatNumber(count)} new ${count === 1 ? 'review' : 'reviews'}`
}

function googleRows(detail: RatingGoalDetailView, context: MovedContext): Dated[] {
  return detail.moved.shownChanges.map((move) => ({
    at: move.at,
    row: {
      key: `google-${move.at}`,
      when: dayOf(move.at, context),
      text: move.up
        ? `Google started showing ${tenthsText(move.tenths)}`
        : `Google went back to ${tenthsText(move.tenths)}`,
      tone: move.up ? 'positive' : 'warn',
    },
  }))
}

/** One row per change of the plan: the fields one manager changed at once, together. */
function planRows(detail: RatingGoalDetailView, context: MovedContext): Dated[] {
  const changes = new Map<string, RatingGoalChangeView[]>()
  for (const change of detail.changes) {
    const key = `${change.changedAt}|${change.changedBy}`
    changes.set(key, [...(changes.get(key) ?? []), change])
  }
  return [...changes.entries()].flatMap(([key, group]) => {
    const first = group[0]
    if (first === undefined) return []
    return [
      {
        at: first.changedAt,
        row: {
          key: `plan-${key}`,
          when: dayOf(first.changedAt, context),
          text: `${nameOf(first.changedBy, context)} changed the plan: ${group.map(changeText).join(' · ')}`,
          tone: null,
        },
      },
    ]
  })
}

/** "Ana set the goal: 4.1 at 1 a day", or "… keep 4.8" for a goal set to keep a number. */
function setRow(detail: RatingGoalDetailView, context: MovedContext): MovedRow {
  const { initialTargetTenths, initialPaceTenthsPerWeek, setBy } = detail.moved
  const target = tenthsText(initialTargetTenths)
  const plan =
    initialPaceTenthsPerWeek === null
      ? `keep ${target}`
      : `${target} at ${paceText(initialPaceTenthsPerWeek)}`
  return {
    key: 'set',
    when: dayOf(detail.setAt, context),
    text: `${nameOf(setBy, context)} set the goal: ${plan}`,
    tone: null,
  }
}

/** The rows, This week first and the set last, twelve at most. */
export function movedRows(
  detail: RatingGoalDetailView,
  context: MovedContext,
): readonly MovedRow[] {
  const week: MovedRow = {
    key: 'week',
    when: 'This week',
    text: thisWeekText(detail.thisWeekCount),
    tone: null,
  }
  const events = [...googleRows(detail, context), ...planRows(detail, context)]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, MAX_ROWS - 2)
    .map((event) => event.row)
  return [week, ...events, setRow(detail, context)]
}
