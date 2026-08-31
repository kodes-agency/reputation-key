// Goal context — public API surface for cross-context consumers.
// Other contexts consume these types to query goal data and subscribe to events.
// Per architecture: contexts must not import from another context's internal layers.

import type { GoalWithProgress } from './use-cases/list-goals'
import type { GoalExecutionPolicy } from './ports/goal-execution-policy'
import type { GoalProgramService } from './use-cases/goal-programs'

// ── DTO re-exports (schemas + inferred types) ─────────────────────────
export type {
  CreateGoalInput,
  UpdateGoalInput,
  CancelGoalInput,
  ListGoalsInput,
  GetGoalInput,
  Goal,
  GoalProgress,
  GoalType,
  GoalStatus,
} from './dto/goal.dto'

export { deriveEntityScope } from './dto/goal.dto'

// ── Port types ────────────────────────────────────────────────────────
export type { GoalRepository, GoalListFilter } from './ports/goal.repository'
export type { GoalActor, GoalExecutionPolicy } from './ports/goal-execution-policy'

// ── Use-case types ────────────────────────────────────────────────────
export type { GoalWithProgress } from './use-cases/list-goals'
export type {
  GovernedGoalDefinition,
  GovernedGoalVersion,
  GovernedGoalPeriod,
  GovernedGoalEvaluation,
} from './ports/governed-goal.repository'
export type {
  GoalProgram,
  GoalProgramVersion,
  GoalSubjectAssignment,
  GoalMonthlyResult,
  GoalResultRevision,
  ClosedGoalResultHead,
  AppendGoalResultRevisionResult,
  GoalProgramBundle,
} from './ports/goal-program.repository'
export type {
  FindMonthlyResultNotificationFactsInput,
  FindMonthlyResultRevisionNotificationFactsInput,
  MonthlyResultNotificationFacts,
  MonthlyResultNotificationFactsLookup,
  MonthlyResultRevisionNotificationFacts,
} from './ports/monthly-result-notification-facts.lookup'
export type {
  GoalMetric,
  GoalSubject,
  GoalProgramStatus,
  GoalMonthlyResultStatus,
  GoalMetricEvaluation,
} from '../domain/goal-program'
export { buildGoalResultsMatrix } from './goal-results-matrix'
export type {
  GoalResultsMatrix,
  GoalResultsMatrixAvailability,
  GoalResultsMatrixEvidence,
  GoalResultsMatrixRow,
} from './goal-results-matrix'
export type {
  GoalAssignmentChangeOutcome,
  GoalAssignmentChangeOutcomeCode,
  GoalAssignmentChangeResult,
} from './use-cases/goal-programs'
export { GoalProgramError } from './use-cases/goal-programs'

/** Request-facing Goal Program commands. The caller supplies its scoped policy
 * to every invocation; no repository or use-case constructor crosses the
 * context boundary. */
export type GoalProgramRequestApi = Readonly<{
  create: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['create']>
  ) => ReturnType<GoalProgramService['create']>
  revise: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['revise']>
  ) => ReturnType<GoalProgramService['revise']>
  changeAssignments: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['changeAssignments']>
  ) => ReturnType<GoalProgramService['changeAssignments']>
  changeStatus: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['changeStatus']>
  ) => ReturnType<GoalProgramService['changeStatus']>
  get: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['get']>
  ) => ReturnType<GoalProgramService['get']>
  list: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['list']>
  ) => ReturnType<GoalProgramService['list']>
}>

// ── Event re-exports — cross-context consumers must import event types from public-api, not domain/events
export type {
  GoalCompleted,
  GoalMonthlyResultClosed,
  GoalMonthlyResultReconciled,
  GoalMonthlyResultRevised,
  GoalEvent,
} from '../domain/events'
export {
  goalCompleted,
  goalMonthlyResultClosed,
  goalMonthlyResultReconciled,
  goalMonthlyResultRevised,
} from '../domain/events'

// ── Staff type alias — reuses GoalWithProgress for cross-context consumers ──
export type StaffGoalEntry = GoalWithProgress
