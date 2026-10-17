// What a goal's measure is called, wherever it is named: on the Goals page, in
// its results matrix, on a group's goal card, on a goal's own page and in its
// forms, and in the name a goal is given when it is created for one subject of
// several. One spelling, so the same measure never reads two ways.
import type { GoalMetric } from '../domain/goal-program'

const LABELS: Readonly<Record<GoalMetric, string>> = {
  qualified_scans: 'Scans',
  portal_rating_count: 'Private ratings',
  portal_rating_average: 'Average private rating',
}

export const goalMetricLabel = (metric: GoalMetric): string => LABELS[metric]
