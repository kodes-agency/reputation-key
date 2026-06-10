// Goal context — staff goals server function
// Lists goals for the currently authenticated staff member's assigned portals.
// Resolves portal IDs → portal group IDs → goals with progress.

import { z } from 'zod/v4'
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { can } from '#/shared/domain/permissions'
import { getContainer } from '#/composition'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import type { StaffGoalEntry } from '../application/public-api'
import type { PortalId, PortalGroupId } from '#/shared/domain/ids'

// ── Schema ──────────────────────────────────────────────────────────

export const listStaffGoalsSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required').optional(),
})

export type ListStaffGoalsInput = z.infer<typeof listStaffGoalsSchema>

// ── Server function ─────────────────────────────────────────────────

export const listStaffGoals = createServerFn({ method: 'GET' })
  .inputValidator(listStaffGoalsSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'goal.read')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No goal read permission' },
            403,
          )
        }

        try {
          const container = getContainer()

          // If no propertyId provided, return empty (caller should supply one)
          if (!data.propertyId) {
            return { goals: [] as StaffGoalEntry[] }
          }

          const propertyId = toPropertyId(data.propertyId)

          // 1. Resolve assigned portals via staff use case
          const portalIds = await container.useCases.getAssignedPortals(
            { userId: ctx.userId, propertyId },
            ctx,
          )

          // 2. Resolve portal groups from portal IDs
          const groupIds =
            portalIds.length > 0
              ? await container.portalRepo.findGroupIdsByPortalIds(
                  ctx.organizationId,
                  portalIds,
                )
              : []

          // 3. Query goals for the org+property, then filter to staff-visible portals/groups
          const allGoals = await container.goalRepo.list({
            organizationId: ctx.organizationId,
            propertyId,
          })

          const portalIdSet = new Set<PortalId>(portalIds)
          const groupIdSet = new Set<PortalGroupId>(groupIds)
          const goals = allGoals.filter((g) => {
            // Property-scoped goals are excluded — staff should not see them
            if (g.portalId === null && g.portalGroupId === null) return false
            if (g.portalId && portalIdSet.has(g.portalId)) return true
            if (g.portalGroupId && groupIdSet.has(g.portalGroupId)) return true
            return false
          })

          if (goals.length === 0) {
            return { goals: [] as StaffGoalEntry[] }
          }

          // 4. Batch-fetch progress for all goals
          const allGoalIds = goals.map((g) => g.id)
          const progressMap = await container.goalRepo.getProgressBatch(allGoalIds)

          const entries: StaffGoalEntry[] = goals.map((goal) => ({
            goal,
            progress: progressMap.get(goal.id) ?? null,
          }))

          return { goals: entries }
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'goal.listStaffGoals',
    ),
  )
