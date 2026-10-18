// The Monthly portal goal's change sheet, worked out (copy deck S-1, S-15…S-23,
// with the set sheet's S-6…S-11; PLAN PG-14): from what the read sent (the
// goal, what a change is made against, and the sheet's offers) and what the
// manager has done in the sheet, every word, number and state it shows, and
// what its primary sends. Two ways to change: "November, now", which judges
// November and the months after it against the new number, and "From Dec 1",
// which leaves November as it is. A change of measure ("Count scans instead")
// is always from the next month: a month counts what it opened with. There
// are no suggested numbers to pick, only the line that says what the number
// is. The read decides the months, the offers and the keys sent back (PLAN
// E12); the sheet's own judgement is whether a number typed for now starts the
// month below pace, by the one pace rule (`goalPace`). Nothing here throws on
// what was typed.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  ChangeMonthlyPortalGoalNowRequest,
  PortalGoalChangeFacts,
  PortalGoalOfCard,
  PortalGoalSheetFacts,
  ReviseMonthlyPortalGoalRequest,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { goalPace } from '#/contexts/reporting/application/goal-pace'
import { formatNumber } from '#/lib/format'
import {
  committedText,
  notesOf,
  numberOf,
  offerFor,
  primaryNumber,
  recommendedText,
  statusOf,
  type PortalGoalSheetBodyModel,
  type PortalGoalSheetChange,
} from './portal-goal-sheet-view'
import {
  dayWords,
  monthName,
  portalGoalCount,
  portalGoalUnit,
  switchOf,
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
  /** The running month has ended since the read (F-2): only the next month is left. */
  nowClosed: boolean
}>

/** One thing the manager did in the change sheet, or that a refusal did to it. */
export type PortalGoalChangeEdit =
  | PortalGoalSheetChange
  | Readonly<{ kind: 'note_open' }>
  | Readonly<{ kind: 'note'; text: string }>
  | Readonly<{ kind: 'now_closed' }>

export type PortalGoalChangeSubmission =
  | Readonly<{ when: 'now'; data: Omit<ChangeMonthlyPortalGoalNowRequest, 'propertyId'> }>
  | Readonly<{ when: 'next'; data: Omit<ReviseMonthlyPortalGoalRequest, 'propertyId'> }>

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

/** "Now" is open while a month runs, for the measure it counts, until it is found ended. */
function nowOpen(
  draft: PortalGoalChangeDraft,
  context: PortalGoalChangeContext,
): boolean {
  return (
    context.change.now !== null &&
    !draft.nowClosed &&
    draft.measure === runningMeasure(context.goal)
  )
}

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
 * The sheet opens on the measure its door named, on the month the read names
 * (now through the 20th), with the number the goal has there now.
 */
export function openingChangeDraft(
  context: PortalGoalChangeContext,
  measure: PortalGoalMeasure,
): PortalGoalChangeDraft {
  const draft: PortalGoalChangeDraft = {
    when: context.change.opensOn,
    measure,
    text: '',
    note: { open: false, text: '' },
    nowClosed: false,
  }
  const when = whenOf(draft, context)
  const text =
    when === 'now' && context.change.now !== null
      ? String(context.change.now.expectedTarget)
      : nextText(measure, context)
  return { ...draft, when, text }
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
      return { ...draft, text: committedText(draft.text) }
    case 'note_open':
      return { ...draft, note: { ...draft.note, open: true } }
    case 'note':
      return { ...draft, note: { open: true, text: edit.text } }
    case 'now_closed':
      return { ...draft, when: 'next', nowClosed: true }
  }
}

/** S-15: "November, now" | "From Dec 1"; only the second while no month can change now. */
function monthsOf(
  draft: PortalGoalChangeDraft,
  context: PortalGoalChangeContext,
): PortalGoalChangeModel['months'] {
  const { now, nextMonthKey } = context.change
  const next = { value: 'next', label: `From ${dayWords(`${nextMonthKey}-01`)}` }
  if (now === null || draft.nowClosed) return [next]
  return [
    {
      value: 'now',
      label: `${monthName(now.monthKey)}, now`,
      disabled: !nowOpen(draft, context),
    },
    next,
  ]
}

/** S-16, S-17, S-22, or S-2 for a goal that has not started. */
function lineOf(
  when: PortalGoalChangeWhen,
  measure: PortalGoalMeasure,
  context: PortalGoalChangeContext,
): string {
  const { goal, change } = context
  if (when === 'now' && change.now !== null) {
    return `${monthName(change.now.monthKey)} is judged against the new number, and so are the months after it.`
  }
  if (change.now === null) return `Starts on ${dayWords(`${change.nextMonthKey}-01`)}.`
  const running = monthName(change.now.monthKey)
  const counts = runningMeasure(goal)
  return measure === counts
    ? `${running} stays at ${formatNumber(change.now.expectedTarget)}.`
    : `${running} keeps counting ${portalGoalUnit(counts, 2)}.`
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
  const note = draft.note.text.trim()
  const shared = {
    programId: goal.programId,
    targetValue: value,
    ...(note === '' ? {} : { note }),
    targetSource: recommended ? ('recommended' as const) : ('own' as const),
  }
  if (when === 'next') {
    return {
      when,
      data: {
        ...shared,
        metric: draft.measure,
        expectedVersion: goal.version,
      },
    }
  }
  if (change.now === null) return null
  const { monthKey, expectedTarget, expectedVersion, expectedFollowingMonth } = change.now
  return {
    when,
    data: {
      ...shared,
      month: monthKey,
      expectedTarget,
      expectedVersion,
      expectedFollowingMonth,
    },
  }
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
    band: monthName(month),
    unit: portalGoalUnit(measure, value ?? 0),
    number,
    choices: null,
    chosen: null,
    status: statusOf(offer, value, context.facts),
    notes: [...notesOf(offer, value), ...(below === null ? [] : [below])],
    asksEveryGuest: measure === 'portal_rating_count',
    offer,
    switchMeasure: switchOf(measure),
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
