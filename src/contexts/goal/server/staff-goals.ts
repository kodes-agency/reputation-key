// Goal context — staff goals server function
// Lists goals for the currently authenticated staff member's assigned portals.
// Business logic extracted into the listStaffGoals use case (D8-002).

import { z } from 'zod/v4'
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { requireAuthorized } from '#/shared/auth/authorization-policy'
import { getContainer } from '#/composition'
import { propertyId as toPropertyId } from '#/shared/domain/ids'

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
        requireAuthorized({ actor: ctx, action: 'goal.read' })

        try {
          const { useCases } = getContainer()
          const goals = await useCases.listStaffGoals(
            {
              propertyId: data.propertyId ? toPropertyId(data.propertyId) : undefined,
            },
            ctx,
          )

          return { goals }
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'goal.listStaffGoals',
    ),
  )
