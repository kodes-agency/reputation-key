// What a goal's metric is called wherever a goal is shown beside a group, a
// portal or a property. One spelling, so the Goals page and a group's goal card
// never name the same measure differently.
import type { GoalMetric } from '#/contexts/reporting/application/public-api'

const LABELS: Readonly<Record<GoalMetric, string>> = {
  qualified_scans: 'Qualified scans',
  portal_rating_count: 'Private ratings',
  portal_rating_average: 'Private rating average',
}

export const goalMetricLabel = (metric: GoalMetric): string => LABELS[metric]
