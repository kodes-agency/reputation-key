// Set goals for several portals — what the table shows.
//
// One row per Portal and per Portal Group of the Property, each with one
// number. A row whose subject already has a goal for the measure takes no
// number: it shows that goal's target and says what frees the subject. After a
// save every row that was sent says what became of it, and a row that got no
// goal stays open for another try. What a save sends and what it leaves on the
// rows is goal-bulk-save.ts.
import type { createGoalsForSubjects } from '#/contexts/reporting/server/goal-bulk-create'
import type { GoalSubjectHold } from '#/contexts/reporting/application/goal-subject-holds'
import type { StatusPresentation } from '#/components/ui/status-badge'
import { goalHeldSentence } from './goal-create-refusal'
import { goalSubjectKey } from './goal-subject-picker'

/** What the save says about one row it was sent. */
export type GoalBulkOutcome = Awaited<
  ReturnType<typeof createGoalsForSubjects>
>['outcomes'][number]

/** A Portal or a Portal Group: what a row sets a goal for. */
export type GoalBulkSubject = GoalBulkOutcome['subject']

export type GoalBulkSubjectRow = Readonly<{
  /** The subject's key: what the row's number and its report are kept under. */
  key: string
  subject: GoalBulkSubject
  name: string
  kind: 'Portal' | 'Portal group'
}>

/** What the last save left on a row. */
export type GoalBulkRowReport =
  | Readonly<{ code: 'created'; programId: string; targetValue: number }>
  | Readonly<{ code: 'invalid_target'; fault: string }>
  | Readonly<{
      code: Exclude<GoalBulkOutcome['code'], 'created' | 'invalid_target'>
    }>

/** The reports of the rows that have one, by subject key. */
export type GoalBulkReport = Readonly<Record<string, GoalBulkRowReport>>

export type GoalBulkRow = GoalBulkSubjectRow &
  Readonly<{
    /**
     * The goal the subject has for the measure. Its target is shown and the
     * row takes no number. The name is null for a goal saved a moment ago
     * whose name has not been read yet.
     */
    goal: Readonly<{ id: string; name: string | null; targetValue: number }> | null
    /** The pill: what the last save, or the goals already set, say about the row. */
    status: StatusPresentation | null
    /** Why the subject is taken and what frees it, under the pill. */
    note: string | null
    /** What is wrong with the number, under its field. */
    fault: string | null
    /** The last save left the row without a goal. */
    failed: boolean
  }>

const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

const subjectRow = (subject: GoalBulkSubject, name: string): GoalBulkSubjectRow => ({
  key: goalSubjectKey(subject),
  subject,
  name,
  kind: subject.kind === 'portal' ? 'Portal' : 'Portal group',
})

/**
 * One row per current Portal and per Portal Group, by name. An archived Portal
 * takes no goal, so it has no row.
 */
export function goalBulkSubjects(
  groups: readonly Readonly<{ id: string; name: string }>[],
  portals: readonly Readonly<{ id: string; name: string; publicationState: string }>[],
): readonly GoalBulkSubjectRow[] {
  return [
    ...groups.map((group) =>
      subjectRow({ kind: 'portal_group', portalGroupId: group.id }, group.name),
    ),
    ...portals
      .filter((portal) => portal.publicationState !== 'archived')
      .map((portal) => subjectRow({ kind: 'portal', portalId: portal.id }, portal.name)),
  ].sort(
    (left, right) =>
      byName.compare(left.name, right.name) || left.key.localeCompare(right.key, 'en'),
  )
}

/**
 * What the tab says instead of a table: a Property with fewer than two Portals
 * or groups has nothing to set several goals for. Null from two rows.
 */
export function goalBulkTooFew(
  subjects: readonly GoalBulkSubjectRow[],
): Readonly<{ title: string; description: string }> | null {
  const [only, another] = subjects
  if (another !== undefined) return null
  if (only === undefined) {
    return {
      title: 'This property has no portals yet',
      description: 'A goal for the property as a whole is set on the One goal tab.',
    }
  }
  return {
    title: `This property has one ${only.kind.toLowerCase()}`,
    description: 'Set its goal on the One goal tab.',
  }
}

const SAVED: StatusPresentation = { label: 'Goal saved', tone: 'positive' }
const NOT_SAVED: StatusPresentation = { label: 'Not saved, try again', tone: 'negative' }

/** The pill of a row the save refused; the field says a wrong number itself. */
const REFUSED: Readonly<
  Record<Exclude<GoalBulkRowReport['code'], 'created'>, StatusPresentation | null>
> = {
  subject_has_goal: { label: 'Already has a goal', tone: 'warn' },
  metric_unavailable: { label: 'Measure not available', tone: 'warn' },
  invalid_subject: { label: 'No longer available', tone: 'warn' },
  invalid_target: null,
  start_month_changed: NOT_SAVED,
  failed: NOT_SAVED,
}

type RowContext = Readonly<{
  /** What other goals hold for the chosen measure from the chosen start. */
  holds: readonly GoalSubjectHold[]
  /** What the last save of this measure and month left on its rows. */
  report: GoalBulkReport
  /** The goals are to start in the current month. */
  startsThisMonth: boolean
  timezone: string
  now: Date
}>

function bulkRow(subject: GoalBulkSubjectRow, context: RowContext): GoalBulkRow {
  const report = context.report[subject.key]
  const hold = context.holds.find(
    (candidate) => goalSubjectKey(candidate.subject) === subject.key,
  )
  const open = { ...subject, goal: null, status: null, note: null, fault: null }
  if (report?.code === 'created') {
    return {
      ...open,
      goal: {
        id: report.programId,
        name: hold?.programId === report.programId ? hold.programName : null,
        targetValue: report.targetValue,
      },
      status: SAVED,
      failed: false,
    }
  }
  if (hold) {
    return {
      ...open,
      goal: { id: hold.programId, name: hold.programName, targetValue: hold.targetValue },
      // Quiet for a goal that was simply there; a warning once a save ran into it.
      status: { label: 'Already has a goal', tone: report ? 'warn' : 'neutral' },
      note: goalHeldSentence(hold, { ...context, subjectName: () => subject.name }),
      failed: report !== undefined,
    }
  }
  if (report === undefined) return { ...open, failed: false }
  return {
    ...open,
    status: REFUSED[report.code],
    fault: report.code === 'invalid_target' ? report.fault : null,
    failed: true,
  }
}

/** The rows of the table for the chosen measure and start. */
export function goalBulkRows(
  input: RowContext & Readonly<{ subjects: readonly GoalBulkSubjectRow[] }>,
): readonly GoalBulkRow[] {
  return input.subjects.map((subject) => bulkRow(subject, input))
}
