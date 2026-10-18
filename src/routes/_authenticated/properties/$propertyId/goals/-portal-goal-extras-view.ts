// The other Portal goals' compact rows, worked out (PLAN PG-21): each goal but
// the one the card shows, named for whom it counts and what ("Reception ·
// Private ratings"; a goal for the Property, such as the average, by its
// measure alone), the first `limit` of them, and whether there are more. Pure.
import type { GoalMetric, GoalSubject } from '#/contexts/reporting/application/public-api'
import { goalListSubjectText } from '#/components/goals/goal-assignment-subject-label'
import { goalMetricLabel } from '#/components/goals/goal-metric-label'

/** What a row needs of a listed goal. */
type ExtraGoal = Readonly<{
  program: Readonly<{ id: string }>
  version: Readonly<{ id: string; metric: GoalMetric }>
  assignments: readonly Readonly<{ programVersionId: string; subject: GoalSubject }>[]
}>

export type PortalGoalExtraRow<G> = Readonly<{
  goal: G
  /** Whom it counts now, by name, and what. */
  name: string
  /** Its subjects now: the current version's. */
  subjects: readonly GoalSubject[]
}>

export function extrasRows<G extends ExtraGoal>(
  goals: readonly G[],
  options: Readonly<{
    /** The Program the card shows as the Monthly portal goal; null when it shows none. */
    monthlyGoalId: string | null
    subjectName: (subject: GoalSubject) => string
    /** How many rows to list; every one when not given. */
    limit?: number
  }>,
): Readonly<{ rows: readonly PortalGoalExtraRow<G>[]; more: boolean }> {
  const { monthlyGoalId, subjectName, limit } = options
  const listed = goals.filter(({ program }) => program.id !== monthlyGoalId)
  const shown = limit === undefined ? listed : listed.slice(0, limit)
  return {
    rows: shown.map((goal) => {
      const subjects = goal.assignments
        .filter(({ programVersionId }) => programVersionId === goal.version.id)
        .map(({ subject }) => subject)
      const measure = goalMetricLabel(goal.version.metric)
      const whom = subjects.every(({ kind }) => kind === 'property')
        ? null
        : goalListSubjectText(subjects, subjectName)
      return { goal, name: whom === null ? measure : `${whom} · ${measure}`, subjects }
    }),
    more: shown.length < listed.length,
  }
}
