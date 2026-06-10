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
import { onPortalDeleted } from './on-portal-deleted'
import { onPortalGroupDeleted } from './on-portal-group-deleted'

// ── Shared deps for entity removal handlers ───────────────────────────

export type CancelGoalFn = (
  input: Readonly<{ goalId: GoalId; organizationId: OrganizationId; role: Role }>,
) => Promise<Result<Goal, unknown>>

// ── Registration deps ─────────────────────────────────────────────────

export type RegisterGoalHandlersDeps = Readonly<{
  goalRepo: GoalRepository
  cancelGoalFn: CancelGoalFn
  eventBus: EventBus
  clock: () => Date
  getLogger: typeof getLoggerType
  findGroupForPortal: (
    orgId: import('#/shared/domain/ids').OrganizationId,
    portalId: import('#/shared/domain/ids').PortalId,
  ) => Promise<{ portalGroupId: import('#/shared/domain/ids').PortalGroupId } | null>
}>

// ── Registration ──────────────────────────────────────────────────────

export const registerGoalEventHandlers = (deps: RegisterGoalHandlersDeps): void => {
  deps.eventBus.on('metric.recorded', onMetricRecorded(deps))
  deps.eventBus.on('portal.deleted', onPortalDeleted(deps))
  deps.eventBus.on('portal_group.deleted', onPortalGroupDeleted(deps))
}
