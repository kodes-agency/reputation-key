// A month's own target overrides its version's target. Evaluation and presentation
// share this rule; goal-running-months.ts mirrors it with SQL coalesce.
// Future-month offers use the head version's target instead.
// Type-only dependencies keep this safe for browser callers.

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
