// Goal context — event handler registration
// Wires all event handlers (metric-recorded + entity removal) to the EventBus.
// Per architecture: "Handlers should not throw. Failures are logged, not propagated to the emitter."

import type { EventBus } from '#/shared/events/event-bus'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { Goal } from '../../domain/types'
import type { GoalId, OrganizationId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'
import type { Result } from 'neverthrow'

import { onMetricRecorded } from './on-metric-recorded'
import { onStaffUnassigned } from './on-staff-unassigned'
import { onPortalDeleted } from './on-portal-deleted'
import { onTeamDeleted } from './on-team-deleted'

// ── Shared deps for entity removal handlers ───────────────────────────

export type CancelGoalFn = (
  input: Readonly<{ goalId: GoalId; organizationId: OrganizationId; role: Role }>,
) => Promise<Result<Goal, unknown>>

// ── Registration deps ─────────────────────────────────────────────────

export type RegisterGoalHandlersDeps = Readonly<{
  events: EventBus
  goalRepo: GoalRepository
  cancelGoalFn: CancelGoalFn
  eventBus: EventBus
  clock: () => Date
  getLogger: typeof getLoggerType
}>

// ── Registration ──────────────────────────────────────────────────────

export const registerGoalEventHandlers = (deps: RegisterGoalHandlersDeps): void => {
  deps.events.on('metric.recorded', onMetricRecorded(deps))
  deps.events.on('staff.unassigned', onStaffUnassigned(deps))
  deps.events.on('portal.deleted', onPortalDeleted(deps))
  deps.events.on('team.deleted', onTeamDeleted(deps))
}
