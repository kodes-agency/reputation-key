// Goal context — public API surface for cross-context consumers.
// Other contexts consume these types to query goal data and subscribe to events.
// Per architecture: contexts must not import from another context's internal layers.

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

// ── Event re-exports — cross-context consumers must import event types from public-api, not domain/events
export type { GoalCompleted, GoalProgressUpdated, GoalEvent } from '../domain/events'
