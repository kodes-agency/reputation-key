// Feed notification surface — copy for the two Portal goal notices.
//
// `goal.completed` and `goal.result_revised` report a portal goal's monthly
// result (ADR 0046, amended 2026-09-24, 2026-10-11 and 2026-10-17). Split out
// of ./notification-templates.ts, which lists these renderers in its table.
// Named exports, as the account and rating goal notices are: a spread of an
// imported record moved a whole module's copy into first paint's chunk. This
// module is a leaf; its copy type is restated structurally below.
//
// The wording was approved under P-8 (PROPOSAL §4.5): a notice names whose
// goal it is — the Property, or the Portal or Portal Group it is on — the
// month, and for a count the month's figure against its target. Every field is
// optional: a missing figure sends the reader to the goal instead, and a
// payload that reached a template unparsed renders rather than throws.
import type {
  NotificationGoalMarker,
  NotificationGoalMeasure,
  NotificationGoalOutcome,
  NotificationPayload,
} from './notification-payload'

/** What a portal goal renderer returns; assignable to the templates' own copy type. */
type PortalGoalNoticeCopy = Readonly<{
  title: string
  body: string
  detail: string
  actionLabel: string
  summary: string
}>

const SEE_THE_GOAL = 'See the goal'
const OPEN_FOR_NUMBERS = 'Open the goal to see the numbers.'

/** Joins non-empty sentences with a single space. */
const sentence = (...parts: ReadonlyArray<string>): string =>
  parts.filter((part) => part !== '').join(' ')

/** One formatter for the month name; the key is already Property-local. */
let monthFormat: Intl.DateTimeFormat | undefined

/**
 * "October" from the `YYYY-MM` key the Property's own calendar closed the
 * month on. Formatted in UTC because the key is a calendar month, not an
 * instant: reading it on any other clock could name the month before it.
 */
const goalMonth = (p: NotificationPayload): string => {
  if (p.goalMonth === undefined) return ''
  const [year, month] = p.goalMonth.split('-').map(Number)
  // The allowlist admits only `YYYY-MM`, but a template must never throw on a
  // payload that reached it unparsed: `Intl.format(NaN)` is a RangeError, and
  // this renders in the bell's own paint.
  if (!Number.isInteger(year) || !Number.isInteger(month)) return ''
  monthFormat ??= new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
  return monthFormat.format(Date.UTC(year!, month! - 1, 1))
}

/**
 * What a reader should know about a month whose target did not stand for all
 * of it. "Met" against a goal set on the 20th is true and still needs saying.
 */
const GOAL_MARKER_CLAUSES: Record<NotificationGoalMarker, string> = {
  set_in_month: 'The goal was set during the month.',
  target_changed: 'The target was changed during the month.',
}

/** The marker's sentence, or nothing for a goal in place the whole month. */
const markerClause = (p: NotificationPayload): string =>
  (p.goalMarker && GOAL_MARKER_CLAUSES[p.goalMarker]) ?? ''

/** Which way a correction left the month, as its title says it. */
const OUTCOME_WORDS: Record<NotificationGoalOutcome, string> = {
  met: 'now met',
  not_met: 'no longer met',
  unavailable: 'result unavailable',
}

/** The words a count measure is counted in: one, and many. */
const COUNT_UNITS: Partial<Record<NotificationGoalMeasure, readonly [string, string]>> = {
  qualified_scans: ['scan', 'scans'],
  portal_rating_count: ['private rating', 'private ratings'],
}

/** Whose goal it is: the Property's name, or the Portal's or Portal Group's. */
const subjectName = (p: NotificationPayload): string | undefined => {
  if (p.goalSubjectKind === 'property') return p.propertyName
  return p.goalSubjectKind === 'portal' || p.goalSubjectKind === 'portal_group'
    ? p.goalSubjectName
    : undefined
}

/** Who brought the month's count in: a Property goal counts all its portals. */
const broughtInBy = (p: NotificationPayload): string | undefined =>
  p.goalSubjectKind === 'property' ? 'Your portals' : subjectName(p)

const wholeNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined

/** A count goal's month and target, or null when the notice cannot state them. */
const countFigures = (p: NotificationPayload) => {
  const units = p.goalMeasure && COUNT_UNITS[p.goalMeasure]
  const count = wholeNumber(p.goalCount)
  const target = wholeNumber(p.goalTargetCount)
  return units === undefined || count === undefined || target === undefined
    ? null
    : { count, target, counted: `${count} ${units[count === 1 ? 0 : 1]}` }
}

/** The copy both notices share around their own title and statement. */
const noticeCopy = (
  p: NotificationPayload,
  title: string,
  statement: string,
): PortalGoalNoticeCopy => ({
  title,
  body: sentence(statement, markerClause(p), statement === '' ? OPEN_FOR_NUMBERS : ''),
  // The row under the title states the month; the marker stays in the body.
  detail: statement,
  actionLabel: SEE_THE_GOAL,
  // Email's facts line names the Property; a digest drops it under the
  // Property's heading and shows the body instead.
  summary: p.propertyName ?? '',
})

/** "Seaview Hotel met its November portal goal" (N-1, N-2, N-8). */
export const renderPortalGoalCompleted = (
  p: NotificationPayload,
): PortalGoalNoticeCopy => {
  const name = subjectName(p)
  const month = goalMonth(p)
  const goal = month === '' ? 'portal goal' : `${month} portal goal`
  const who = broughtInBy(p)
  const figures = countFigures(p)
  return noticeCopy(
    p,
    name === undefined
      ? `${month === '' ? 'Portal goal' : goal} met`
      : `${name} met its ${goal}`,
    figures === null || who === undefined
      ? ''
      : `${who} brought in ${figures.counted}. The goal was ${figures.target}.`,
  )
}

/** "Seaview Hotel’s November portal goal: no longer met" (N-3, N-4, N-5, N-8). */
export const renderPortalGoalResultRevised = (
  p: NotificationPayload,
): PortalGoalNoticeCopy => {
  const name = subjectName(p)
  const month = goalMonth(p)
  const outcome = p.goalOutcome && OUTCOME_WORDS[p.goalOutcome]
  const goal = sentence(
    name === undefined ? '' : `${name}’s`,
    month,
    name === undefined && month === '' ? '' : 'portal goal',
  )
  const figures = countFigures(p)
  let statement = ''
  if (month !== '' && p.goalOutcome === 'unavailable') {
    statement = `A correction left ${month} with no usable result.`
  } else if (month !== '' && outcome !== undefined && figures !== null) {
    statement = `A correction changed ${month} to ${figures.count} of ${figures.target}.`
  }
  return noticeCopy(
    p,
    outcome === undefined || goal === ''
      ? 'Portal goal result updated'
      : `${goal}: ${outcome}`,
    statement,
  )
}
