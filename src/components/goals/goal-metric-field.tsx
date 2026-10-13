// The Goal's metric, as the select the new-goal page and the revision dialog share
// (UI consistency scan: FORM-03). Each was a copy of a browser <select>; this is the
// shared Select in the shared field frame, and what each of the three metrics counts
// is written once. Their names are the goal page's (`goalPageMetricLabel`).
import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import { FormSelectField } from '#/components/forms/form-select-field'
import { goalPageMetricLabel } from './goal-detail-view'

const GOAL_METRIC_DESCRIPTIONS: ReadonlyArray<
  Readonly<{ value: GoalMetric; description: string }>
> = [
  {
    value: 'qualified_scans',
    description:
      'Counts eligible portal scans. You can configure this now; results remain scheduled until scan attribution is active.',
  },
  {
    value: 'portal_rating_count',
    description: 'Counts private 1–5 star ratings submitted through the review gateway.',
  },
  {
    value: 'portal_rating_average',
    description:
      'Average private star rating. A monthly result needs at least 10 eligible ratings.',
  },
]

const GOAL_METRICS = GOAL_METRIC_DESCRIPTIONS.map((metric) => ({
  ...metric,
  label: goalPageMetricLabel(metric.value),
}))

/** The metric's own description, for the help under the select. */
const goalMetricDescription = (metric: GoalMetric): string =>
  GOAL_METRICS.find((candidate) => candidate.value === metric)?.description ?? ''

type MetricFieldApi = Readonly<{
  state: Readonly<{
    value: GoalMetric
    meta: Readonly<{
      isValid: boolean
      errors: Array<{ message?: string } | undefined>
    }>
  }>
  handleBlur: () => void
  handleChange: (metric: GoalMetric) => void
}>

export function GoalMetricField({
  id,
  field,
  withDescription = false,
  disabled = false,
}: Readonly<{
  id: string
  field: MetricFieldApi
  /** Say what the chosen metric counts, under the select. */
  withDescription?: boolean
  /** Not to be changed now: a save for the metric it shows is running. */
  disabled?: boolean
}>) {
  return (
    <FormSelectField
      id={id}
      label="Metric"
      value={field.state.value}
      options={GOAL_METRICS}
      description={withDescription ? goalMetricDescription(field.state.value) : undefined}
      disabled={disabled}
      invalid={!field.state.meta.isValid}
      errors={field.state.meta.errors}
      onValueChange={field.handleChange}
      onBlur={field.handleBlur}
    />
  )
}
