// The target a goal month is judged against.
//
// A month can carry its own target; when it does not, it uses the target of the
// Program version it belongs to. Everything that evaluates a month or shows its
// target reads it through here, so the two can never disagree.
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
