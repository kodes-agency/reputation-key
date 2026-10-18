// The average private rating goal's change sheet, worked out (PLAN PG-21; copy
// deck S-15…S-21 in tenths, M-14): from the goal as its page read sent it and
// what the manager has done in the sheet, every word and state it shows, and
// what its primary sends. Two ways to change, as for a count: "November, now",
// which judges November and the months after it against the new level, and
// "From Dec 1", which leaves November as it is. There is no recommended
// average, so no suggestions and no "How we worked this out": the box opens on
// the level the goal has where the change would go, and the number sent is
// always the manager's own. It never changes what the goal measures. The read
// decides the months and the keys sent back (PLAN E12). Nothing here throws on
// what was typed. Pure.
import type { PortalGoalChangeFacts } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import type { PortalGoalAverageOfPage } from '#/contexts/reporting/application/dto/portal-goal-single-page.types'
import {
  AVERAGE_METRIC,
  AVERAGE_NEEDS,
  AVERAGE_UNIT,
  averageBox,
  averageWords,
  committedText,
} from './portal-goal-add-number-view'
import {
  changeSubmissionOf,
  type PortalGoalChangeSubmission,
} from './portal-goal-change-submission'
import type { PortalGoalSheetModel } from './portal-goal-sheet-view'
import { dayWords, monthName } from './portal-goal-words'

/** The longest note the commands keep (the Program commands' own limit). */
const NOTE_LIMIT = 500

type When = 'now' | 'next'

/** What the sheet works from: the average as its page read sent it. */
export type PortalGoalAverageChangeContext = Readonly<{
  goal: Pick<PortalGoalAverageOfPage, 'programId' | 'version' | 'target' | 'status'>
  change: PortalGoalChangeFacts
}>

export type PortalGoalAverageChangeDraft = Readonly<{
  when: When
  /** What the box holds, exactly as typed. */
  text: string
  note: Readonly<{ open: boolean; text: string }>
}>

export type PortalGoalAverageChangeEdit =
  | Readonly<{ kind: 'month'; month: string }>
  | Readonly<{ kind: 'number'; value: number }>
  | Readonly<{ kind: 'type'; text: string }>
  | Readonly<{ kind: 'commit' }>
  | Readonly<{ kind: 'note_open' }>
  | Readonly<{ kind: 'note'; text: string }>

export type PortalGoalAverageChangeModel = Pick<
  PortalGoalSheetModel,
  'description' | 'months' | 'month' | 'band' | 'unit' | 'number' | 'primary'
> &
  Readonly<{
    /** M-14: what an average needs. */
    status: string
    /** S-19: "Add a note", then the field. */
    note: Readonly<{ open: boolean; text: string; limit: number }>
    submission: PortalGoalChangeSubmission | null
    /** What is said once it is saved. */
    toast: string | null
  }>

/** "Now" only while a month runs: else the change is from the next month. */
const whenOf = (
  draft: PortalGoalAverageChangeDraft,
  change: PortalGoalChangeFacts,
): When => (draft.when === 'now' && change.now !== null ? 'now' : 'next')

/** The level the goal already has where this change would put the new one. */
function standingLevel(when: When, context: PortalGoalAverageChangeContext): number {
  const { goal, change } = context
  return when === 'now' && change.now !== null ? change.now.expectedTarget : goal.target
}

/** The sheet opens on the month the read names (now through the 20th), with the level there. */
export function openingAverageDraft(
  context: PortalGoalAverageChangeContext,
): PortalGoalAverageChangeDraft {
  const when: When =
    context.change.opensOn === 'now' && context.change.now !== null ? 'now' : 'next'
  return {
    when,
    text: averageWords(standingLevel(when, context)),
    note: { open: false, text: '' },
  }
}

export function changedAverageDraft(
  draft: PortalGoalAverageChangeDraft,
  edit: PortalGoalAverageChangeEdit,
): PortalGoalAverageChangeDraft {
  switch (edit.kind) {
    // The level typed is the new level, whichever month it is for.
    case 'month':
      return { ...draft, when: edit.month === 'now' ? 'now' : 'next' }
    case 'number':
      return { ...draft, text: averageWords(edit.value) }
    case 'type':
      return { ...draft, text: edit.text }
    case 'commit':
      return { ...draft, text: committedText(draft.text, true) }
    case 'note_open':
      return { ...draft, note: { ...draft.note, open: true } }
    case 'note':
      return { ...draft, note: { open: true, text: edit.text } }
  }
}

/** S-15: "November, now" | "From Dec 1"; only the second while no month can change now. */
function monthsOf(change: PortalGoalChangeFacts): PortalGoalAverageChangeModel['months'] {
  const next = {
    value: 'next',
    label: `From ${dayWords(`${change.nextMonthKey}-01`)}`,
  }
  if (change.now === null) return [next]
  return [{ value: 'now', label: `${monthName(change.now.monthKey)}, now` }, next]
}

/** S-16, S-17 in tenths, or S-2 for a goal that has not started. */
function lineOf(when: When, context: PortalGoalAverageChangeContext): string {
  const { goal, change } = context
  const { now, nextMonthKey } = change
  if (when === 'now' && now !== null) {
    const judged = `${monthName(now.monthKey)} is judged against the new number`
    return now.appliesToFollowing
      ? `${judged}, and so are the months after it.`
      : `${judged}.`
  }
  if (now === null || goal.status === 'scheduled') {
    return `Starts on ${dayWords(`${nextMonthKey}-01`)}.`
  }
  return `${monthName(now.monthKey)} stays at ${averageWords(now.expectedTarget)}.`
}

/** There is no recommended average: the level sent is always the manager's own. */
function submissionOf(
  when: When,
  draft: PortalGoalAverageChangeDraft,
  value: number,
  context: PortalGoalAverageChangeContext,
): PortalGoalChangeSubmission | null {
  const { goal, change } = context
  return changeSubmissionOf(
    {
      when,
      programId: goal.programId,
      version: goal.version,
      metric: AVERAGE_METRIC,
      targetValue: value,
      note: draft.note.text,
      targetSource: 'own',
    },
    change,
  )
}

export function portalGoalAverageChangeModel(
  draft: PortalGoalAverageChangeDraft,
  context: PortalGoalAverageChangeContext,
): PortalGoalAverageChangeModel {
  const when = whenOf(draft, context.change)
  const { now, nextMonthKey } = context.change
  const month = when === 'now' && now !== null ? now.monthKey : nextMonthKey
  const number = averageBox(draft.text)
  const { value } = number
  const ready = value !== null && value !== standingLevel(when, context)
  const level = value === null ? '' : averageWords(value)
  const verb = when === 'now' ? `for ${monthName(month)}` : `from ${monthName(month)}`
  return {
    description: lineOf(when, context),
    months: monthsOf(context.change),
    month: when,
    band: monthName(month),
    unit: AVERAGE_UNIT,
    number,
    status: AVERAGE_NEEDS,
    primary: {
      label: value === null ? 'Set goal' : `Set ${level} ${verb}`,
      disabled: !ready,
    },
    note: { ...draft.note, limit: NOTE_LIMIT },
    submission: ready ? submissionOf(when, draft, value, context) : null,
    toast:
      value === null
        ? null
        : when === 'now'
          ? `${monthName(month)} goal: ${level} ${AVERAGE_UNIT}`
          : `From ${monthName(month)}: ${level} ${AVERAGE_UNIT}`,
  }
}
