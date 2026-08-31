// Goal context — retained Staff Goal compatibility declaration.
// The beta Staff surface uses GoalProgram results. Authenticated callers of
// this historical entry receive an explicit 410 before container/data access.

import { z } from 'zod/v4'
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import {
  LegacyGoalAuthorityError,
  denyLegacyGoalBetaEntry,
} from '../application/goal-authority-inventory'

// ── Schema ──────────────────────────────────────────────────────────

export const listStaffGoalsSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required').optional(),
})

export type ListStaffGoalsInput = z.infer<typeof listStaffGoalsSchema>

// ── Server function ─────────────────────────────────────────────────

export const listStaffGoals = createServerFn({ method: 'GET' })
  .validator(listStaffGoalsSchema)
  .handler(
    tracedHandler(
      async () => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'goal.read' })

        try {
          return denyLegacyGoalBetaEntry('legacy-goal.staff-server-read')
        } catch (error) {
          if (error instanceof LegacyGoalAuthorityError) {
            throwContextError(
              error.name,
              { code: error.code, message: error.message },
              410,
            )
          }
          throw error
        }
      },
      'GET',
      'goal.listStaffGoals',
    ),
  )
