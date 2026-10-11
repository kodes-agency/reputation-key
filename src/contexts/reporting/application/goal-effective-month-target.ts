// The target a goal month is judged against.
//
// A month can carry its own target; when it does not, it uses the target of the
// Program version it belongs to. Evaluation reads the target through here, when
// a month is reconciled and when a closed one is corrected. The two behind-pace
// queries restate the rule in SQL as
// `coalesce(result.target_value, version.target_value)`.
//
// Every surface that shows the target of a month reads it through here too:
// the goal card (goal-progress.ts), the results matrix and the month rows of
// the goal's page. A surface that shows the goal's target for the months to
// come reads the head version's, which is a different question.
//
// Type-only imports: this module is safe to reach from a route or a component.
import type {
  GoalMonthlyResult,
  GoalProgramVersion,
} from './ports/goal-program.repository'

/**
 * `version` must be the version the month belongs to (`programVersionId`),
 * which is not always the Program's current one.
 */
export function effectiveMonthTarget(
  result: Pick<GoalMonthlyResult, 'targetValue'>,
  version: Pick<GoalProgramVersion, 'targetValue'>,
): number {
  return result.targetValue ?? version.targetValue
}
