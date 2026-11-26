import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import type { AuthContext } from '#/shared/domain/auth-context'
import { propertyId } from '#/shared/domain/ids'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import { checkScopedCapability } from '#/shared/auth/beta-capabilities'
import { withDashboard } from './dashboard-request.server'
import { tracedHandler } from '#/shared/observability/traced-server-fn'

const propertySetupInputSchema = z.object({ propertyId: z.uuid() })

/**
 * Setup describes Property configuration, so `property.read` governs its
 * scope: Organization-wide for an AccountAdmin, granted Properties for a
 * PropertyManager.
 */
async function accessiblePropertyIds(ctx: AuthContext) {
  return getContainer().identityPublicApi.people.getAccessiblePropertyIds(
    ctx.organizationId,
    ctx.userId,
    scopeForPermission(ctx, 'property.read') === 'organization',
  )
}

/**
 * Whether the rating goal step is the viewer's: they may set a Google rating
 * goal (`goal.create`) and Goals are on (`goal.use`). A step they could not act on is not shown to them.
 */
function ratingGoalsEnabled(ctx: AuthContext): boolean {
  if (!canForContext(ctx, 'goal.create')) return false
  return checkScopedCapability({ organizationId: ctx.organizationId }, 'goal.use').allowed
}

/** One Property's setup steps for the settings hub, property page and composer. */
export const getPropertySetupFn = createServerFn({ method: 'GET' })
  .validator(propertySetupInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withDashboard(async (ctx) => {
          await requireExecutionAllowed({
            actor: ctx,
            action: 'property.read',
            propertyId: data.propertyId,
          })
          return await getContainer().dashboardPublicApi.getPropertySetup({
            organizationId: ctx.organizationId,
            role: ctx.role,
            propertyId: propertyId(data.propertyId),
            accessiblePropertyIds: await accessiblePropertyIds(ctx),
            ratingGoalsEnabled: ratingGoalsEnabled(ctx),
          })
        }),
      'GET',
      'dashboard.getPropertySetup',
    ),
  )

/** Setup progress for every Property the manager can access (properties list). */
export const listPropertySetupSummariesFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () =>
      withDashboard(async (ctx) => {
        await requireExecutionAllowed({ actor: ctx, action: 'property.read' })
        return await getContainer().dashboardPublicApi.listPropertySetupSummaries({
          organizationId: ctx.organizationId,
          role: ctx.role,
          accessiblePropertyIds: await accessiblePropertyIds(ctx),
          ratingGoalsEnabled: ratingGoalsEnabled(ctx),
        })
      }),
    'GET',
    'dashboard.listPropertySetupSummaries',
  ),
)
