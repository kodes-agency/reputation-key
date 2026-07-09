// Goal context — event handler registration
// Wires all event handlers (metric-recorded + entity removal) to the EventBus.
// Per architecture: "Handlers should not throw. Failures are logged, not propagated to the emitter."

import type { EventBus } from '#/shared/events/event-bus'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { Goal } from '../../domain/types'
import type { GoalId, OrganizationId, PortalId, PortalGroupId } from '#/shared/domain/ids'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'
import type { Result } from '#/shared/domain'
import type { SystemCancelReason } from '../../application/use-cases/system-cancel-goal'

import { onMetricRecorded } from './on-metric-recorded'
import { onPortalDeleted } from './on-portal-deleted'
import { onPortalGroupDeleted } from './on-portal-group-deleted'

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
) => Promise<Result<Goal, unknown>>

// ── Registration deps ─────────────────────────────────────────────────

export type RegisterGoalHandlersDeps = Readonly<{
  goalRepo: GoalRepository
  systemCancelGoalFn: SystemCancelGoalFn
  eventBus: EventBus
  clock: () => Date
  getLogger: typeof getLoggerType
  findGroupForPortal: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<{ portalGroupId: PortalGroupId } | null>
}>

// ── Registration ──────────────────────────────────────────────────────

export const registerGoalEventHandlers = (deps: RegisterGoalHandlersDeps): void => {
  deps.eventBus.on('metric.recorded', onMetricRecorded(deps))
  deps.eventBus.on('portal.deleted', onPortalDeleted(deps))
  deps.eventBus.on('portal_group.deleted', onPortalGroupDeleted(deps))
}
