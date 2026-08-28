// Goal context — retained legacy event-handler boundary.
//
// The handler implementations remain migration evidence, but GoalProgram is
// the sole beta authority. This module deliberately exports no `register*`
// function, so repository-wide consumer discovery cannot mistake the retained
// source for a composed consumer.

import type { EventBus } from '#/shared/events/event-bus'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { Goal } from '../../domain/types'
import type { GoalId, OrganizationId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Result } from '#/shared/domain'
import type {
  SystemCancelGoalError,
  SystemCancelReason,
} from '../../application/use-cases/system-cancel-goal'

// ── Shared deps for entity removal handlers ───────────────────────────

/**
 * System-initiated goal cancellation — skips the `can()` gate and
 * property-access self-assignment guard (system actions are not
 * impersonating a staff member) and carries a tagged `reason` audit marker.
 */
export type SystemCancelGoalFn = (
  input: Readonly<{
    goalId: GoalId
    organizationId: OrganizationId
    reason: SystemCancelReason
  }>,
) => Promise<Result<Goal, SystemCancelGoalError>>

// ── Registration deps ─────────────────────────────────────────────────

export type RegisterGoalHandlersDeps = Readonly<{
  goalRepo: GoalRepository
  systemCancelGoalFn: SystemCancelGoalFn
  eventBus: EventBus
  clock: () => Date
  logger: Pick<LoggerPort, 'error'>
}>

// ── Registration ──────────────────────────────────────────────────────

export const legacyGoalEventHandlersAreDisabled = (
  _deps: RegisterGoalHandlersDeps,
): true => true
