// The Goal's metric, as the select the new-goal page and the revision dialog share
// (UI consistency scan: FORM-03). Each was a copy of a browser <select>; this is the
// shared Select in the shared field frame, and the three metrics (with what each one
// counts) are written once.
import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import { FormSelectField } from '#/components/forms/form-select-field'

const GOAL_METRICS: ReadonlyArray<
  Readonly<{ value: GoalMetric; label: string; description: string }>
> = [
  {
    value: 'qualified_scans',
    label: 'Qualified scans',
    description:
      'Counts eligible portal scans. You can configure this now; results remain scheduled until scan attribution is active.',
  },
  {
    value: 'portal_rating_count',
    label: 'Private rating count',
    description: 'Counts private 1–5 star ratings submitted through the review gateway.',
  },
  {
    value: 'portal_rating_average',
    label: 'Private rating average',
    description:
      'Average private star rating. A monthly result needs at least 10 eligible ratings.',
  },
]

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
}: Readonly<{
  id: string
  field: MetricFieldApi
  /** Say what the chosen metric counts, under the select. */
  withDescription?: boolean
}>) {
  return (
    <FormSelectField
      id={id}
      label="Metric"
      value={field.state.value}
      options={GOAL_METRICS}
      description={withDescription ? goalMetricDescription(field.state.value) : undefined}
      invalid={!field.state.meta.isValid}
      errors={field.state.meta.errors}
      onValueChange={field.handleChange}
      onBlur={field.handleBlur}
    />
  )
}
