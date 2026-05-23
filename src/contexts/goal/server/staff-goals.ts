// Goal context — staff goals server function
// Lists goals for the currently authenticated staff member.
// Stub: returns empty array until staff assignment resolution is wired.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { getContainer } from '#/composition'
import type { Goal, GoalProgress } from '../domain/types'

// fallow-ignore-file unused-export
export type GoalWithProgress = {
  goal: Goal
  progress: GoalProgress | null
}

export const listStaffGoals = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const headers = headersFromContext()
      const ctx = await resolveTenantContext(headers)

      // Stub: resolve user's staff assignments, then query goals for each.
      // For Phase 15C, return empty — will be wired when data flow is ready.
      void ctx
      void getContainer

      return { goals: [] as GoalWithProgress[] }
    },
    'GET',
    'goal.listStaffGoals',
  ),
)
