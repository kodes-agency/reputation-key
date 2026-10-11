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
// says the whole result, and the focus goes to the first row that got no goal.
// Those rows stay open: saving again sends them again, and a row that got its
// goal the first time is no longer sent.
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
import { EmptyState } from '#/components/ui/empty-state'
import { RegionError } from '#/components/ui/region-error'
import { FormActions } from '#/components/forms/form-actions'
import { submitHandler } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import { GoalBulkPending } from './goal-bulk-pending'
import { GoalBulkRows } from './goal-bulk-rows'
import {
  goalBulkFirstFailed,
  goalBulkReportOf,
  goalBulkReportOnEdit,
  goalBulkSubmission,
  goalBulkSummary,
} from './goal-bulk-save'
import {
  goalBulkRows,
  goalBulkSubjects,
  goalBulkTooFew,
  type GoalBulkReport,
  type GoalBulkSubjectRow,
} from './goal-bulk-view'
import { GOAL_MONTH_CHANGED, goalRefusalCode } from './goal-create-refusal'
import { GoalMetricField } from './goal-metric-field'
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
  /** How that read is going, for what stands in the table's place without it. */
  goalsRead: Readonly<{ failed: boolean; retrying: boolean; onRetry: () => void }>
  /** The two months a goal may start in, as the page last read them. */
  start: GoalStartChoice
  now: Date
  /** The command no longer offers the month that was sent: read the months again. */
  onMonthChanged: () => void
}>

const NO_REPORT: GoalBulkReport = {}

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
        onRetry={props.goalsRead.onRetry}
        retrying={props.goalsRead.retrying}
      />
    ) : (
      <GoalBulkPending />
    )
  }
  return <GoalBulkForm {...props} subjects={subjects} programs={props.programs} />
}

type FormProps = Omit<GoalBulkTableProps, 'groups' | 'portals' | 'goalsRead'> &
  Readonly<{ subjects: readonly GoalBulkSubjectRow[]; programs: GoalBundles }>

function GoalBulkForm({
  createGoalsForSubjectsFn,
  property,
  subjects,
  programs,
  start,
  now,
  onMonthChanged,
}: FormProps) {
  const [metric, setMetric] = useState<GoalMetric>('portal_rating_count')
  const [pickedMonth, setPickedMonth] = useState<string | null>(null)
  const [targets, setTargets] = useState<Readonly<Record<string, number>>>({})
  // What the saves left on the rows, kept per measure and month: a goal saved
  // for one measure says nothing about the same row under another.
  const [reports, setReports] = useState<Readonly<Record<string, GoalBulkReport>>>({})
  const [summary, setSummary] = useState('')
  // What the last attempt was refused with as a whole: a sentence, or the failure.
  const [refusal, setRefusal] = useState<unknown>(null)
  const [focusOn, setFocusOn] = useState<Readonly<{ key: string }> | null>(null)
  const rowElements = useRef(new Map<string, HTMLElement>())
  // No toast: the rows and the live region say what was saved, and a save
  // refused as a whole is the banner above the button.
  const save = useActionMutation(createGoalsForSubjectsFn, {
    invalidateKeys: [goalKeys.all],
  })

  // After the rows have been drawn again: a row that got no goal has its
  // number field, or the link to the goal that holds its subject.
  useEffect(() => {
    if (focusOn === null) return
    rowElements.current
      .get(focusOn.key)
      ?.querySelector<HTMLElement>('input, a[href]')
      ?.focus()
  }, [focusOn])

  const startMonth = offeredStartMonth(start, pickedMonth)
  const startsThisMonth = startMonth === start.current.monthKey
  const startLabels = goalStartLabels(start, property.timezone, now)
  const scope = `${metric} ${startMonth}`
  const rows = goalBulkRows({
    subjects,
    holds: subjectHolds(
      programs,
      metric,
      (startsThisMonth ? start.current : start.next).period.start,
    ),
    report: reports[scope] ?? NO_REPORT,
    startsThisMonth,
    timezone: property.timezone,
    now,
  })

  /** A new measure or month is another table: what the last save said is not about it. */
  const forgetLastSave = () => {
    setSummary('')
    setRefusal(null)
  }
  /** Lays what an attempt left over the rows and sends the focus to the first without a goal. */
  const layOver = (left: GoalBulkReport) => {
    setReports((all) => ({ ...all, [scope]: { ...all[scope], ...left } }))
    const failed = goalBulkFirstFailed(left, rows)
    if (failed !== null) setFocusOn({ key: failed })
  }

  const submit = async () => {
    forgetLastSave()
    const submission = goalBulkSubmission(rows, targets, metric)
    if (!submission.ok) {
      layOver(submission.report)
      setRefusal(submission.message)
      return
    }
    try {
      const { outcomes } = await save({
        data: {
          propertyId: property.id,
          metric,
          startMonth,
          items: [...submission.items],
        },
      })
      layOver(goalBulkReportOf(outcomes, { metric, targets }))
      setSummary(goalBulkSummary(outcomes))
    } catch (error) {
      if (goalRefusalCode(error) !== 'start_month_changed') {
        setRefusal(error)
        return
      }
      setRefusal(GOAL_MONTH_CHANGED)
      onMonthChanged()
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={submitHandler({ handleSubmit: submit })}
    >
      <Card>
        <CardHeader>
          <CardTitle as="h2">Set goals for several portals</CardTitle>
          <CardDescription>
            One number per portal. Each becomes its own goal.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          <GoalMetricField
            id="goal-bulk-metric"
            withDescription
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
          />
        </CardContent>
      </Card>
      <div className="flex flex-col gap-2">
        <GoalBulkRows
          propertyId={property.id}
          metric={metric}
          rows={rows}
          targets={targets}
          onTargetChange={(key, value) => {
            setTargets((all) => ({ ...all, [key]: value }))
            setReports((all) => ({
              ...all,
              [scope]: goalBulkReportOnEdit(all[scope] ?? NO_REPORT, key),
            }))
          }}
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
      <FormActions error={refusal}>
        <SubmitButton mutation={save} pendingLabel="Saving…">
          Save goals
        </SubmitButton>
      </FormActions>
    </form>
  )
}
