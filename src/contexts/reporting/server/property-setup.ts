import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import { propertyId } from '#/shared/domain/ids'
import { scopeForPermission } from '#/shared/domain/permissions'
import { standardErrorStatus as dashboardErrorStatus } from '#/shared/http/status'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { isDashboardError } from '../domain/dashboard-errors'

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

function mapPropertySetupError(error: unknown): never {
  if (isDashboardError(error)) {
    throwContextError('DashboardError', error, dashboardErrorStatus(error.code))
  }
  throw catchUntagged(error)
}

/** One Property's seven setup steps for the settings hub, property page and composer. */
export const getPropertySetupFn = createServerFn({ method: 'GET' })
  .validator(propertySetupInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)
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
          })
        } catch (error) {
          mapPropertySetupError(error)
        }
      },
      'GET',
      'dashboard.getPropertySetup',
    ),
  )

/** Setup progress for every Property the manager can access (properties list). */
export const listPropertySetupSummariesFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      try {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'property.read' })
        return await getContainer().dashboardPublicApi.listPropertySetupSummaries({
          organizationId: ctx.organizationId,
          role: ctx.role,
          accessiblePropertyIds: await accessiblePropertyIds(ctx),
        })
      } catch (error) {
        mapPropertySetupError(error)
      }
    },
    'GET',
    'dashboard.listPropertySetupSummaries',
  ),
)
