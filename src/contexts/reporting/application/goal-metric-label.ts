// What a goal's measure is called, wherever it is named: on the Goals page, on
// a group's goal card, and in the name a goal is given when it is created for
// one subject of several. One spelling, so the same measure never reads two
// ways.
import type { GoalMetric } from '../domain/goal-program'

const LABELS: Readonly<Record<GoalMetric, string>> = {
  qualified_scans: 'Qualified scans',
  portal_rating_count: 'Private ratings',
  portal_rating_average: 'Private rating average',
}

export const goalMetricLabel = (metric: GoalMetric): string => LABELS[metric]
