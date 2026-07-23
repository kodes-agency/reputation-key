// Goal context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the goal context.
// Also registers event handlers on the shared EventBus so that every process
// (web server + worker) handles metric.recorded etc. without needing a
// separate bootstrap() call.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { MetricPublicApi } from '#/contexts/metric/application/public-api'
import type { PortalGroupPublicApi } from '#/contexts/portal/application/public-api'
import type { OrganizationId, PortalId, PortalGroupId } from '#/shared/domain/ids'
import type { GoalRepository } from './application/ports/goal.repository'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { createGoalRepository } from './infrastructure/repositories/goal.repository'
import { createGoal } from './application/use-cases/create-goal'
import { updateGoal } from './application/use-cases/update-goal'
import { cancelGoal } from './application/use-cases/cancel-goal'
import { systemCancelGoal } from './application/use-cases/system-cancel-goal'
import { listGoals } from './application/use-cases/list-goals'
import { getGoal } from './application/use-cases/get-goal'
import {
  listStaffGoals,
  type PortalGroupLookupPort,
  type ListStaffGoals,
} from './application/use-cases/list-staff-goals'
import { registerGoalEventHandlers } from './infrastructure/event-handlers'

export type GoalContextBuildInput = Readonly<{
  db: Database
  metricApi: MetricPublicApi
  events: EventBus
  outboxRepo?: import('#/shared/outbox').OutboxRepository
  clock: () => Date
  idGen: () => string
  staffPublicApi: StaffPublicApi
  getLogger: typeof getLoggerType
  /** Portal group resolution (portal public API) — the build wraps it into
   * the findGroupForPortal + portalGroupLookup shapes goal consumes. */
  portalGroupApi: PortalGroupPublicApi
}>

export type GoalContextApi = Readonly<{
  publicApi: Readonly<{
    createGoal: ReturnType<typeof createGoal>
    updateGoal: ReturnType<typeof updateGoal>
    cancelGoal: ReturnType<typeof cancelGoal>
    listGoals: ReturnType<typeof listGoals>
    getGoal: ReturnType<typeof getGoal>
  }>
  internal: Readonly<{
    repos: Readonly<{
      goalRepo: GoalRepository
    }>
    useCases: Readonly<{
      createGoal: ReturnType<typeof createGoal>
      updateGoal: ReturnType<typeof updateGoal>
      cancelGoal: ReturnType<typeof cancelGoal>
      listGoals: ReturnType<typeof listGoals>
      getGoal: ReturnType<typeof getGoal>
      listStaffGoals: ListStaffGoals
    }>
    events: EventBus
  }>
}>

export const buildGoalContext = (input: GoalContextBuildInput): GoalContextApi => {
  const goalRepo = createGoalRepository(input.db)

  // Portal group resolution — portal public API wrapped into goal's shapes.
  const findGroupForPortal = async (
    orgId: OrganizationId,
    pid: PortalId,
  ): Promise<{ portalGroupId: PortalGroupId } | null> => {
    const group = await input.portalGroupApi.findGroupForPortal(orgId, pid)
    return group ? { portalGroupId: group.id } : null
  }
  // Resolve portal group IDs for a batch of portal IDs (staff goals visibility).
  const portalGroupLookup: PortalGroupLookupPort = {
    findGroupIdsByPortalIds: (orgId, portalIds) =>
      input.portalGroupApi.findGroupIdsByPortalIds(orgId, portalIds),
  }

  const _createGoal = createGoal({
    goalRepo,
    metricRepo: input.metricApi,
    staffPublicApi: input.staffPublicApi,
    idGen: input.idGen,
    clock: input.clock,
  })

  const _updateGoal = updateGoal({
    goalRepo,
    staffPublicApi: input.staffPublicApi,
    clock: input.clock,
  })

  const _cancelGoal = cancelGoal({
    goalRepo,
    staffPublicApi: input.staffPublicApi,
    clock: input.clock,
  })

  // System-initiated cancellation — skips the `can()` gate and
  // property-access self-assignment guard; carries a tagged reason audit marker.
  const _systemCancelGoal = systemCancelGoal({
    goalRepo,
    clock: input.clock,
    getLogger: input.getLogger,
  })

  const _listGoals = listGoals({
    goalRepo,
    staffPublicApi: input.staffPublicApi,
  })

  const _getGoal = getGoal({
    goalRepo,
    staffPublicApi: input.staffPublicApi,
  })

  const _listStaffGoals = listStaffGoals({
    goalRepo,
    staffPublicApi: input.staffPublicApi,
    portalGroupLookup,
  })

  // Register event handlers (metric.recorded, portal_group.deleted, etc.)
  // Per architecture: handlers are registered at build time so every process
  // (web server + worker) handles events without a separate bootstrap() call.
  registerGoalEventHandlers({
    eventBus: input.events,
    goalRepo,
    systemCancelGoalFn: _systemCancelGoal,
    clock: input.clock,
    getLogger: input.getLogger,
    findGroupForPortal,
  })

  return {
    publicApi: {
      createGoal: _createGoal,
      updateGoal: _updateGoal,
      cancelGoal: _cancelGoal,
      listGoals: _listGoals,
      getGoal: _getGoal,
    },
    internal: {
      repos: { goalRepo },
      useCases: {
        createGoal: _createGoal,
        updateGoal: _updateGoal,
        cancelGoal: _cancelGoal,
        listGoals: _listGoals,
        getGoal: _getGoal,
        listStaffGoals: _listStaffGoals,
      },
      events: input.events,
    },
  }
}
