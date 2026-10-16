// "What moved you" on the Google rating goal's detail page (round 5, PLAN-D
// D-2 and D-2b, mock D3), worked out (pure): this week's new reviews and their
// stars first, then each day Google's own number moved, each change of the
// plan and each low review since the set, newest first, and the day the goal
// was set, always last. Past events keep their short dates (E21); only
// arrivals are durations. A low review says what it set the goal back ("about
// 8 new reviews", measured today against the goal) and links to the Inbox
// item that opens it, when this viewer may open one: the page never has its
// review id (the owner's exception, ADR 0067 2026-10-17).
import type {
  RatingGoalChangeView,
  RatingGoalDetailView,
  RatingGoalThisWeekView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { formatNumber, formatShortDate } from '#/lib/format'
import { paceText } from './rating-goal-pace-words'
import { reviewCountText } from './rating-goal-tracking-words'
import { changeText, tenthsText } from './rating-goal-view'

/** The list shows this many rows at most, the set's row among them. */
const MAX_ROWS = 12

export type MovedRow = Readonly<{
  key: string
  /** "This week", or the event's short date. */
  when: string
  text: string
  /** Google's number up (positive ink), down or a low review (warn ink); none for the rest. */
  tone: 'positive' | 'warn' | null
  /** After the toned words, a low review's setback: "set you back about 8 new reviews". */
  detail?: string | null
  /** A low review's Inbox item; null when this viewer may not open one. */
  inboxItemId?: string | null
  /** The link's own name: its visible words first (WCAG 2.5.3), then which review it opens. */
  linkLabel?: string
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

/** The stars of this week's reviews: "4★", "both 5★", "all 5★", "average 4.6★". */
function weekStars(week: RatingGoalThisWeekView): string | null {
  if (week.allStars !== null) {
    const all = week.count === 1 ? '' : week.count === 2 ? 'both ' : 'all '
    return `${all}${week.allStars}★`
  }
  return week.averageTenths === null ? null : `average ${tenthsText(week.averageTenths)}★`
}

/** "No new reviews yet", "1 new review, 4★", "2 new reviews, both 5★", "3 new reviews, average 4.7★". */
export function thisWeekText(week: RatingGoalThisWeekView): string {
  if (week.count === 0) return 'No new reviews yet'
  const count = `${formatNumber(week.count)} new ${week.count === 1 ? 'review' : 'reviews'}`
  const stars = weekStars(week)
  return stars === null ? count : `${count}, ${stars}`
}

/** One row per low review since the set, the Inbox item that opens it beside it. */
function lowRows(detail: RatingGoalDetailView, context: MovedContext): Dated[] {
  return detail.moved.lowReviews.map((review, index) => {
    const when = dayOf(review.at, context)
    return {
      at: review.at,
      row: {
        key: `low-${index}`,
        when,
        text: `${review.stars}★ review`,
        tone: 'warn',
        detail:
          review.setBack === null
            ? null
            : `set you back about ${reviewCountText(review.setBack, false)}`,
        inboxItemId: review.inboxItemId,
        linkLabel: `Open in the inbox: the ${review.stars}★ review of ${when}`,
      },
    }
  })
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
    text: thisWeekText(detail.moved.thisWeek),
    tone: null,
  }
  const events = [
    ...googleRows(detail, context),
    ...planRows(detail, context),
    ...lowRows(detail, context),
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, MAX_ROWS - 2)
    .map((event) => event.row)
  return [week, ...events, setRow(detail, context)]
}
