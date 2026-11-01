// The Monthly portal goal's change sheet, worked out (copy deck S-1, S-15…S-23,
// with the set sheet's S-6…S-11; PLAN PG-14): from what the read sent (the
// goal, what a change is made against, and the sheet's offers) and what the
// manager has done in the sheet, every word, number and state it shows, and
// what its primary sends. Two ways to change: "November, now", which judges
// November and the months after it against the new number, and "From Dec 1",
// which leaves November as it is. A change of measure ("Count scans instead")
// is always from the next month: a month counts what it opened with, so a
// change of number keeps each month's own measure, and once the next month
// counts the other one, a change now is November's alone. There
// are no suggested numbers to pick, only the line that says what the number
// is. The read decides the months, the offers and the keys sent back (PLAN
// E12); the sheet's own judgement is whether a number typed for now starts the
// month below pace, by the one pace rule (`goalPace`). Nothing here throws on
// what was typed.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalChangeFacts,
  PortalGoalOfCard,
  PortalGoalSheetFacts,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { goalPace } from '#/contexts/reporting/application/goal-pace'
import { formatNumber } from '#/lib/format'
import {
  changeSubmissionOf,
  type PortalGoalChangeSubmission,
} from './portal-goal-change-submission'
import {
  committedCount,
  numberOf,
  offerFor,
  primaryNumber,
  recommendedText,
  type PortalGoalSheetBodyModel,
  type PortalGoalSheetChange,
} from './portal-goal-sheet-view'
import { countsLine, notesOf, statusOf } from './portal-goal-sheet-words'
import {
  dayWords,
  monthName,
  portalGoalCount,
  portalGoalUnit,
  switchOf,
  unitInMonth,
} from './portal-goal-words'

/** The longest note the commands keep (the Program commands' own limit). */
const NOTE_LIMIT = 500

export type PortalGoalChangeWhen = 'now' | 'next'

/** What the change sheet works from: the goal as the read sent it. */
export type PortalGoalChangeContext = Readonly<{
  goal: PortalGoalOfCard
  change: PortalGoalChangeFacts
  facts: PortalGoalSheetFacts
  /** The sheet's clock, for "starts below pace". */
  now: Date
}>

/** What the manager has chosen so far. */
export type PortalGoalChangeDraft = Readonly<{
  when: PortalGoalChangeWhen
  measure: PortalGoalMeasure
  /** What the number box holds, exactly as typed. */
  text: string
  note: Readonly<{ open: boolean; text: string }>
}>

/** One thing the manager did in the change sheet. */
export type PortalGoalChangeEdit =
  | PortalGoalSheetChange
  | Readonly<{ kind: 'note_open' }>
  | Readonly<{ kind: 'note'; text: string }>

export type PortalGoalChangeModel = PortalGoalSheetBodyModel &
  Readonly<{
    /** S-19: "Add a note", then the field. */
    note: Readonly<{ open: boolean; text: string; limit: number }>
    submission: PortalGoalChangeSubmission | null
    /** S-21: what is said once it is saved. */
    toast: string | null
  }>

/** What the month now running counts: a change from a coming month leaves it as it was. */
const runningMeasure = (goal: PortalGoalOfCard): PortalGoalMeasure =>
  goal.month?.measure ?? goal.countingMonth?.measure ?? goal.measure

/** "Now" is open while a month runs, for the measure it counts. */
const nowOpen = (draft: PortalGoalChangeDraft, context: PortalGoalChangeContext) =>
  context.change.now !== null && draft.measure === runningMeasure(context.goal)

const whenOf = (draft: PortalGoalChangeDraft, context: PortalGoalChangeContext) =>
  draft.when === 'now' && nowOpen(draft, context) ? 'now' : 'next'

/** The month a change is for: the running one now, else the one the next change starts. */
function monthOfWhen(when: PortalGoalChangeWhen, change: PortalGoalChangeFacts): string {
  return when === 'now' && change.now !== null ? change.now.monthKey : change.nextMonthKey
}

/**
 * The box for a measure from the next month: the goal's own number for its own
 * measure, else the one recommended for that month (or nothing).
 */
function nextText(measure: PortalGoalMeasure, context: PortalGoalChangeContext): string {
  const { goal, change, facts } = context
  if (measure === goal.measure) return String(goal.target)
  return recommendedText(offerFor(facts, change.nextMonthKey, measure))
}

/**
 * The sheet opens on the month the read names (now through the 20th), with
 * the number the goal has there now, in that month's own measure. A door that
 * names the other measure than the goal's ("Count scans instead", or back to
 * private ratings) is a switch: from the next month only.
 */
export function openingChangeDraft(
  context: PortalGoalChangeContext,
  measure: PortalGoalMeasure,
): PortalGoalChangeDraft {
  const { goal, change } = context
  const now = measure === goal.measure && change.opensOn === 'now' ? change.now : null
  const note = { open: false, text: '' }
  if (now === null) {
    return { when: 'next', measure, text: nextText(measure, context), note }
  }
  const own = runningMeasure(goal)
  return { when: 'now', measure: own, text: String(now.expectedTarget), note }
}

export function changedChangeDraft(
  draft: PortalGoalChangeDraft,
  edit: PortalGoalChangeEdit,
  context: PortalGoalChangeContext,
): PortalGoalChangeDraft {
  switch (edit.kind) {
    // The number typed is the new number, whichever month it is for.
    case 'month':
      return { ...draft, when: edit.month === 'now' ? 'now' : 'next' }
    case 'measure':
      // A number of one measure is no number of the other; another measure
      // than the running month's is from the next month.
      return {
        ...draft,
        measure: edit.measure,
        when: edit.measure === runningMeasure(context.goal) ? draft.when : 'next',
        text: nextText(edit.measure, context),
      }
    case 'number':
      return { ...draft, text: String(edit.value) }
    case 'type':
      return { ...draft, text: edit.text }
    case 'commit':
      return { ...draft, text: committedCount(draft.text) }
    case 'note_open':
      return { ...draft, note: { ...draft.note, open: true } }
    case 'note':
      return { ...draft, note: { open: true, text: edit.text } }
  }
}

/** S-15: "November, now" | "From Dec 1"; only the second while no month can change now. */
function monthsOf(
  draft: PortalGoalChangeDraft,
  context: PortalGoalChangeContext,
): PortalGoalChangeModel['months'] {
  const { now, nextMonthKey } = context.change
  const next = { value: 'next', label: `From ${dayWords(`${nextMonthKey}-01`)}` }
  if (now === null) return [next]
  return [
    {
      value: 'now',
      label: `${monthName(now.monthKey)}, now`,
      disabled: !nowOpen(draft, context),
    },
    next,
  ]
}

/**
 * The month counting now, which a change from a coming month leaves as it is:
 * the one to change now, or, in the hour before its month is opened, the
 * card's; none for a goal that has not started.
 */
function runningOf(context: PortalGoalChangeContext) {
  const { goal, change } = context
  if (change.now !== null) {
    return { key: change.now.monthKey, target: change.now.expectedTarget }
  }
  return goal.status === 'scheduled' ? null : goal.month
}

/** S-16 (alone while the next month counts the other measure), S-17, S-22, or S-2. */
function lineOf(
  when: PortalGoalChangeWhen,
  measure: PortalGoalMeasure,
  context: PortalGoalChangeContext,
): string {
  const { now, nextMonthKey } = context.change
  if (when === 'now' && now !== null) {
    const judged = `${monthName(now.monthKey)} is judged against the new number`
    return now.appliesToFollowing
      ? `${judged}, and so are the months after it.`
      : `${judged}.`
  }
  const running = runningOf(context)
  if (running === null) return `Starts on ${dayWords(`${nextMonthKey}-01`)}.`
  const counts = runningMeasure(context.goal)
  return measure === counts
    ? `${monthName(running.key)} stays at ${formatNumber(running.target)}.`
    : `${monthName(running.key)} keeps counting ${portalGoalUnit(counts, 2)}.`
}

/** S-18: a number for now that the month so far is already behind. */
function belowPaceNote(
  value: number | null,
  measure: PortalGoalMeasure,
  context: PortalGoalChangeContext,
): string | null {
  const { goal, change } = context
  const soFar = goal.month?.value ?? null
  if (value === null || soFar === null || change.now === null) return null
  const { period, timezone } = change.now
  const { state } = goalPace({
    metric: measure,
    value: soFar,
    target: value,
    period: { start: new Date(period.start), end: new Date(period.end) },
    now: context.now,
    timezone,
  })
  return state === 'behind'
    ? `At ${formatNumber(soFar)} so far, ${formatNumber(value)} starts below pace.`
    : null
}

/** The number the goal already has where this change would put the new one. */
function standingNumber(
  when: PortalGoalChangeWhen,
  measure: PortalGoalMeasure,
  context: PortalGoalChangeContext,
): number | null {
  const { goal, change } = context
  if (when === 'now') return change.now?.expectedTarget ?? null
  return measure === goal.measure ? goal.target : null
}

function submissionOf(
  when: PortalGoalChangeWhen,
  draft: PortalGoalChangeDraft,
  value: number,
  context: PortalGoalChangeContext,
  recommended: boolean,
): PortalGoalChangeSubmission | null {
  const { goal, change } = context
  return changeSubmissionOf(
    {
      when,
      programId: goal.programId,
      version: goal.version,
      metric: draft.measure,
      targetValue: value,
      note: draft.note.text,
      targetSource: recommended ? 'recommended' : 'own',
    },
    change,
  )
}

export function portalGoalChangeModel(
  draft: PortalGoalChangeDraft,
  context: PortalGoalChangeContext,
): PortalGoalChangeModel {
  const { measure } = draft
  const when = whenOf(draft, context)
  const month = monthOfWhen(when, context.change)
  const offer = offerFor(context.facts, month, measure)
  const { value, number } = numberOf(measure, draft.text)
  const unchanged = value !== null && value === standingNumber(when, measure, context)
  // Only a number for the running month starts it below pace.
  const below =
    when === 'now' && !unchanged ? belowPaceNote(value, measure, context) : null
  const ready = value !== null && !unchanged
  const count = value === null ? '' : primaryNumber(measure, value)
  const verb = when === 'now' ? `for ${monthName(month)}` : `from ${monthName(month)}`
  return {
    title: 'Change your monthly portal goal',
    description: lineOf(when, measure, context),
    months: monthsOf(draft, context),
    month: when,
    unit: unitInMonth(portalGoalUnit(measure, value ?? 0), month),
    number,
    choices: null,
    chosen: null,
    status: statusOf(offer, value, context.facts),
    notes: [...notesOf(offer, value), ...(below === null ? [] : [below])],
    asksEveryGuest: measure === 'portal_rating_count',
    offer,
    counts: countsLine(measure),
    switchMeasure:
      measure === 'qualified_scans' && context.facts.ratingsAvailable === false
        ? null
        : switchOf(measure),
    primary: ready
      ? { label: `Set ${count} ${verb}`, disabled: false }
      : { label: value === null ? 'Set goal' : `Set ${count} ${verb}`, disabled: true },
    note: { ...draft.note, limit: NOTE_LIMIT },
    submission: ready
      ? submissionOf(when, draft, value, context, value === offer?.choices.aBitMore)
      : null,
    toast:
      value === null
        ? null
        : when === 'now'
          ? `${monthName(month)} goal: ${portalGoalCount(measure, value)}`
          : `From ${monthName(month)}: ${portalGoalCount(measure, value)}`,
  }
}
