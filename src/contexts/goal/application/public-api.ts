// Goal context — public API surface for cross-context consumers.
// Other contexts consume these types to query goal data and subscribe to events.
// Per architecture: contexts must not import from another context's internal layers.

// ── DTO re-exports (schemas + inferred types) ─────────────────────────
export type { Goal } from './dto/goal.dto'

// ── Port types ────────────────────────────────────────────────────────
export type { GoalExecutionPolicy } from './ports/goal-execution-policy'

// ── Use-case types ────────────────────────────────────────────────────
export type { GoalProgram, GoalSubjectAssignment } from './ports/goal-program.repository'
export type {
  MonthlyResultNotificationFactsLookup,
  MonthlyResultRevisionNotificationFacts,
} from './ports/monthly-result-notification-facts.lookup'
export type { GoalMetric, GoalSubject } from '../domain/goal-program'
export { buildGoalResultsMatrix } from './goal-results-matrix'
export type {
  GoalResultsMatrix,
  GoalResultsMatrixEvidence,
  GoalResultsMatrixRow,
} from './goal-results-matrix'
export type { GoalAssignmentChangeOutcome } from './use-cases/goal-programs'
export { GoalProgramError } from './use-cases/goal-programs'

// ── Event re-exports — cross-context consumers must import event types from public-api, not domain/events
export type {
  GoalCompleted,
  GoalMonthlyResultClosed,
  GoalMonthlyResultReconciled,
  GoalEvent,
} from '../domain/events'
export { goalMonthlyResultClosed } from '../domain/events'
