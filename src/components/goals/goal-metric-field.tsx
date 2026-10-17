// The Goal's metric, as the select the new-goal page and the revision dialog share
// (UI consistency scan: FORM-03). Each was a copy of a browser <select>; this is the
// shared Select in the shared field frame, and what each of the three metrics counts
// is written once. Their names are every goal surface's (`goalMetricLabel`).
import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import { FormSelectField } from '#/components/forms/form-select-field'
import { goalMetricLabel } from './goal-metric-label'

const GOAL_METRIC_DESCRIPTIONS: ReadonlyArray<
  Readonly<{ value: GoalMetric; description: string }>
> = [
  {
    value: 'qualified_scans',
    description:
      'Counts guests who open a portal from its code. The same visit counts once per portal in any 24 hours.',
  },
  {
    value: 'portal_rating_count',
    description: 'Counts the 1–5 star private ratings guests give at your portals.',
  },
  {
    value: 'portal_rating_average',
    description:
      'The average private rating guests give at your portals. A month needs at least 10 ratings.',
  },
]

const GOAL_METRICS = GOAL_METRIC_DESCRIPTIONS.map((metric) => ({
  ...metric,
  label: goalMetricLabel(metric.value),
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
