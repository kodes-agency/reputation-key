// When a change to a goal applies from, in words.
//
// A change to a goal's measure, target or subjects starts with a whole month
// on the Property's calendar. Which month depends on how far the goal has come
// (reporting CONTEXT.md, invariant 2): a goal that has not started keeps its
// start month, a change still waiting for its month is replaced from that
// month, and a goal that is counting changes after every month still open. The
// dialogs ask the same rule the commands use, so the date a manager reads
// before saving is the one the change is saved with, and the receipt states
// the start the command answered.
import { nextRevisionStart } from '#/contexts/reporting/application/goal-revision-start'
import { formatShortDate } from '#/lib/format'

/** The part of a Goal Program version that says when it starts. */
export type GoalVersionStart = Readonly<{ effectiveFrom: Date; propertyTimezone: string }>

/** What the start of a goal's next change is read from: its status, head version and months. */
export type GoalChangeSource = Parameters<typeof nextRevisionStart>[0]

/**
 * "Nov 1", with its year once it is not the year the reader is in, in the
 * Property timezone the version was cut in. After the Property's timezone
 * moves east a change can start a month later than the next one, and the
 * month in between is not evaluated (reporting CONTEXT.md, invariant 2), so
 * the date is always stated, never implied.
 */
const startDay = (start: Date, timezone: string, now: Date): string =>
  formatShortDate(start, timezone, now) ?? 'a later date'

/** The day the next change to this goal would apply from, were it saved at `now`. */
const nextChangeDay = (goal: GoalChangeSource, now: Date, timezone: string): string =>
  startDay(nextRevisionStart(goal, now, timezone).period.start, timezone, now)

/**
 * What the revision dialog says under its title. `timezone` is the Property's
 * own: a revision is cut in the zone the Property has now.
 */
export function goalRevisionDescription(
  goal: GoalChangeSource,
  now: Date,
  timezone: string,
): string {
  return `Applies from ${nextChangeDay(goal, now, timezone)}.`
}

/**
 * What the subjects dialog says under its title. `timezone` is the current
 * version's: a change of subjects keeps the zone its version was cut in.
 */
export function goalAssignmentsDescription(
  goal: GoalChangeSource,
  now: Date,
  timezone: string,
): string {
  return `Changes apply from ${nextChangeDay(goal, now, timezone)}.`
}

/**
 * The receipt a change dialog keeps on screen once the change is saved, with
 * the start the command answered: the revision dialog under its fields, the
 * subjects dialog above what became of each subject. In the revision dialog it
 * is the only word on the success: the dialog stays open on it, so a toast
 * saying the same thing again would be a second channel for one event.
 */
export function goalRevisionReceipt(version: GoalVersionStart, now: Date): string {
  const day = startDay(version.effectiveFrom, version.propertyTimezone, now)
  return `Change saved. Applies from ${day} (${version.propertyTimezone}).`
}
