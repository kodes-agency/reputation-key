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

          // 1. Resolve assigned portals via staff public API
          const portalIds = await container.staffPublicApi.getAssignedPortals(
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

          // 3. Query goals for portals and groups only (staff should not see property-scoped goals)
          const goals = await container.goalRepo.listByPortalAndGroupIds({
            organizationId: ctx.organizationId,
            portalIds,
            groupIds,
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
