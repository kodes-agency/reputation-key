// Goal context — staff goals server function
// Lists goals for the currently authenticated staff member.
// Stub: returns empty array until staff assignment resolution is wired.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { can } from '#/shared/domain/permissions'
import type { Goal, GoalProgress } from '../application/public-api'

// fallow-ignore-file unused-export
export type StaffGoalEntry = {
  goal: Goal
  progress: GoalProgress | null
}

export const listStaffGoals = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const headers = headersFromContext()
      const ctx = await resolveTenantContext(headers)
      if (!can(ctx.role, 'goal.read')) {
        throwContextError(
          'AuthError',
          { code: 'forbidden', message: 'No goal read permission' },
          403,
        )
      }

      // Stub: resolve user's staff assignments, then query goals for each.
      // For Phase 15C, return empty — will be wired when data flow is ready.

      return { goals: [] as StaffGoalEntry[] }
    },
    'GET',
    'goal.listStaffGoals',
  ),
)
