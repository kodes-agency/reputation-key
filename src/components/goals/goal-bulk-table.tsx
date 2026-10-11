// Set goals for several portals — the second view of the New goal page. One
// number per Portal or Portal Group and one save: each filled row becomes its
// own goal, for the measure and the start month chosen above the table.
//
// A chunk of its own: the page loads it only for this view (`lazy`), so the
// single goal form does not carry it.
//
// A row whose subject already has a goal for the measure is read from the
// Property's goals before any row is drawn, so it takes no number. After a
// save every row that was sent says what became of it, a polite live region
// says the whole result, and the focus goes to the first row that got no goal,
// or stays with the row the person was in. Rows without a goal stay open:
// saving again sends them again, and a row that got its goal the first time is
// no longer sent. A number belongs to the measure it was typed for
// (goal-bulk-entries.ts), so another measure never inherits it.
import { useEffect, useRef, useState } from 'react'
import { Target } from 'lucide-react'
import type { createGoalsForSubjects } from '#/contexts/reporting/server/goal-bulk-create'
import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import { subjectHolds } from '#/contexts/reporting/application/goal-subject-holds'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { goalKeys } from '#/shared/queries/query-keys'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { BackLink } from '#/components/ui/back-link'
import { EmptyState } from '#/components/ui/empty-state'
import { RegionError } from '#/components/ui/region-error'
import { FormActions } from '#/components/forms/form-actions'
import { submitHandler } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  GOAL_BULK_NO_ENTRIES,
  goalBulkAnswered,
  goalBulkEdited,
  goalBulkHeldBack,
  goalBulkReportIn,
  goalBulkTargetsOf,
} from './goal-bulk-entries'
import { GoalBulkPending } from './goal-bulk-pending'
import { GoalBulkRows } from './goal-bulk-rows'
import {
  goalBulkFirstFailed,
  goalBulkMayHaveSaved,
  goalBulkRefusal,
  goalBulkReportOf,
  goalBulkSubmission,
  goalBulkSummary,
} from './goal-bulk-save'
import {
  goalBulkNothingLeft,
  goalBulkRows,
  goalBulkSubjects,
  goalBulkTooFew,
  type GoalBulkSubjectRow,
} from './goal-bulk-view'
import { GoalMetricField } from './goal-metric-field'
import { goalRefusalCode } from './goal-refusal'
import { GoalStartField } from './goal-start-field'
import {
  goalStartLabels,
  offeredStartMonth,
  type GoalStartChoice,
} from './goal-start-view'

/** The Property's goals, as the goal list returns them. */
type GoalBundles = Parameters<typeof subjectHolds>[0]

export type GoalBulkTableProps = Readonly<{
  createGoalsForSubjectsFn: typeof createGoalsForSubjects
  property: Readonly<{ id: string; timezone: string }>
  groups: readonly Readonly<{ id: string; name: string }>[]
  portals: readonly Readonly<{ id: string; name: string; publicationState: string }>[]
  /** The Property's goals; undefined until they have been read. */
  programs: GoalBundles | undefined
  /**
   * How that read is going, for what stands in the table's place without it,
   * and how to read the goals again: after a read that failed, and after a
   * save that may have gone through without its answer arriving.
   */
  goalsRead: Readonly<{ failed: boolean; retrying: boolean; readAgain: () => void }>
  /** The two months a goal may start in, as the page last read them. */
  start: GoalStartChoice
  now: Date
  /** The command no longer offers the month that was sent: read the months again. */
  onMonthChanged: () => void
}>

type RowElements = ReadonlyMap<string, HTMLElement>

/** The row the focus is in, if any: where it stays when that row's field is gone after a save. */
function rowInFocus(rows: RowElements): string | null {
  const active = document.activeElement
  for (const [key, element] of rows) if (element.contains(active)) return key
  return null
}

/**
 * The rows whose field holds text it cannot read as a number ("4,5" where the
 * browser wants "4.5"). Such a field reports no value, so only it can tell the
 * row from an empty one.
 */
const unreadableRows = (rows: RowElements): readonly string[] =>
  [...rows]
    .filter(([, element]) => element.querySelector('input')?.validity.badInput === true)
    .map(([key]) => key)

export function GoalBulkTable(props: GoalBulkTableProps) {
  const subjects = goalBulkSubjects(props.groups, props.portals)
  const tooFew = goalBulkTooFew(subjects)
  if (tooFew !== null) {
    return (
      <EmptyState icon={Target} title={tooFew.title} description={tooFew.description} />
    )
  }
  // Only while there are no goals to go by: a later read that fails (the one
  // after a save) leaves the table, and what was typed into it, where it is.
  if (props.programs === undefined) {
    return props.goalsRead.failed ? (
      <RegionError
        message="The goals couldn’t be loaded."
        description="The table needs them to know which portals already have a goal."
        onRetry={props.goalsRead.readAgain}
        retrying={props.goalsRead.retrying}
      />
    ) : (
      <GoalBulkPending />
    )
  }
  return (
    <GoalBulkForm
      {...props}
      subjects={subjects}
      programs={props.programs}
      onGoalsStale={props.goalsRead.readAgain}
    />
  )
}

type FormProps = Omit<GoalBulkTableProps, 'groups' | 'portals' | 'goalsRead'> &
  Readonly<{
    subjects: readonly GoalBulkSubjectRow[]
    programs: GoalBundles
    /** The goals in hand may be behind what was saved: read them again. */
    onGoalsStale: () => void
  }>

function GoalBulkForm({
  createGoalsForSubjectsFn,
  property,
  subjects,
  programs,
  onGoalsStale,
  start,
  now,
  onMonthChanged,
}: FormProps) {
  const [metric, setMetric] = useState<GoalMetric>('portal_rating_count')
  const [pickedMonth, setPickedMonth] = useState<string | null>(null)
  // The numbers typed and what the saves left, for every measure and month
  // the person has looked at: neither is carried from one table into another.
  const [entries, setEntries] = useState(GOAL_BULK_NO_ENTRIES)
  const [summary, setSummary] = useState('')
  // What the last attempt was refused with as a whole: a sentence, or the failure.
  const [refusal, setRefusal] = useState<unknown>(null)
  // Where the focus goes once the rows are drawn again; no row is `key: null`.
  const [focusOn, setFocusOn] = useState<Readonly<{ key: string | null }> | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const rowElements = useRef(new Map<string, HTMLElement>())
  // No toast: the rows and the live region say what was saved, and a save
  // refused as a whole is the banner above the button.
  const save = useActionMutation(createGoalsForSubjectsFn, {
    invalidateKeys: [goalKeys.all],
  })

  // After the rows have been drawn again. A row has its number field, or the
  // link to the goal its subject has. With no row to go to, the focus is only
  // moved when what had it is gone (the field of a row that got its goal, or
  // the Save button once no row is open): then the way on takes it, so it never
  // falls to the top of the page.
  useEffect(() => {
    if (focusOn === null) return
    const row = focusOn.key === null ? undefined : rowElements.current.get(focusOn.key)
    const inRow = row?.querySelector<HTMLElement>('input, a[href]')
    if (inRow) inRow.focus()
    else if (!form.current?.contains(document.activeElement)) {
      end.current?.querySelector<HTMLElement>('a[href]')?.focus()
    }
  }, [focusOn])

  const startMonth = offeredStartMonth(start, pickedMonth)
  const startsThisMonth = startMonth === start.current.monthKey
  const startLabels = goalStartLabels(start, property.timezone, now)
  const scope = { metric, startMonth }
  const targets = goalBulkTargetsOf(entries, metric)
  const rows = goalBulkRows({
    subjects,
    holds: subjectHolds(
      programs,
      metric,
      (startsThisMonth ? start.current : start.next).period.start,
    ),
    report: goalBulkReportIn(entries, scope),
    startsThisMonth,
    timezone: property.timezone,
    now,
  })
  const nothingLeft = goalBulkNothingLeft(rows)
  // The way on, once a save has left no row without its goal.
  const backToGoals = (
    <BackLink
      to="/properties/$propertyId/goals"
      params={{ propertyId: property.id }}
      label="Back to goals"
    />
  )

  /** A new measure or month is another table: what the last save said is not about it. */
  const forgetLastSave = () => {
    setSummary('')
    setRefusal(null)
  }

  const submit = async () => {
    forgetLastSave()
    const from = rowInFocus(rowElements.current)
    const submission = goalBulkSubmission(
      rows,
      targets,
      metric,
      unreadableRows(rowElements.current),
    )
    if (!submission.ok) {
      setEntries((all) => goalBulkHeldBack(all, scope, submission.report))
      setRefusal(submission.message)
      const wrong = goalBulkFirstFailed(submission.report, rows)
      if (wrong !== null) setFocusOn({ key: wrong })
      return
    }
    try {
      const { outcomes } = await save({
        data: { propertyId: property.id, ...scope, items: [...submission.items] },
      })
      const left = goalBulkReportOf(outcomes, { metric, targets })
      setEntries((all) => goalBulkAnswered(all, scope, left))
      setSummary(goalBulkSummary(outcomes))
      setFocusOn({ key: goalBulkFirstFailed(left, rows) ?? from })
    } catch (error) {
      setRefusal(goalBulkRefusal(error))
      // Each row is written on its own, so a save that failed on the way may
      // have left goals behind: the rows must show them before the next try.
      if (goalBulkMayHaveSaved(error)) onGoalsStale()
      if (goalRefusalCode(error) === 'start_month_changed') onMonthChanged()
    }
  }

  return (
    <form
      ref={form}
      noValidate
      className="flex flex-col gap-4"
      // Built when the form is submitted: `submit` reads the rows' elements.
      onSubmit={(event) => submitHandler({ handleSubmit: submit })(event)}
    >
      <Card>
        <CardHeader>
          <CardTitle as="h2">Set goals for several portals</CardTitle>
          <CardDescription>
            One number per portal. Each becomes its own goal.
          </CardDescription>
        </CardHeader>
        {/* Neither changes while a save runs: its answer is about the table it was sent from. */}
        <CardContent className="grid gap-5 lg:grid-cols-2">
          <GoalMetricField
            id="goal-bulk-metric"
            withDescription
            disabled={save.isPending}
            field={{
              state: { value: metric, meta: { isValid: true, errors: [] } },
              handleBlur: () => undefined,
              handleChange: (next) => {
                setMetric(next)
                forgetLastSave()
              },
            }}
          />
          <GoalStartField
            legend="When do these goals start?"
            options={[
              { monthKey: start.current.monthKey, label: startLabels.current },
              { monthKey: start.next.monthKey, label: startLabels.next },
            ]}
            value={startMonth}
            onValueChange={(monthKey) => {
              setPickedMonth(monthKey)
              forgetLastSave()
            }}
            soFar={null}
            disabled={save.isPending}
          />
        </CardContent>
      </Card>
      <div className="flex flex-col gap-2">
        <GoalBulkRows
          propertyId={property.id}
          metric={metric}
          rows={rows}
          targets={targets}
          onTargetChange={(key, value) =>
            setEntries((all) => goalBulkEdited(all, metric, key, value))
          }
          rowRef={(key, element) => {
            if (element === null) rowElements.current.delete(key)
            else rowElements.current.set(key, element)
          }}
        />
        {/* Always here, so the result is an update to a region a screen reader already knows. */}
        <p role="status" className="min-h-4 text-sm text-muted-foreground">
          {summary}
        </p>
      </div>
      <div ref={end}>
        {nothingLeft === null ? (
          <FormActions
            error={refusal}
            leading={
              summary !== '' && rows.every((row) => !row.failed) ? backToGoals : undefined
            }
          >
            <SubmitButton mutation={save} pendingLabel="Saving…">
              Save goals
            </SubmitButton>
          </FormActions>
        ) : (
          // No row takes a number, so there is nothing to save: no button to press in vain.
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{nothingLeft}</p>
            {backToGoals}
          </div>
        )}
      </div>
    </form>
  )
}
