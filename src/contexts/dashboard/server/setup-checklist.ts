import { createServerFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { isDashboardError } from '../domain/errors'
import { standardErrorStatus as setupChecklistErrorStatus } from '#/shared/http/status'

/** One authenticated, role-aware authority for the resumable setup projection. */
export const getSetupChecklistFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      try {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        // dashboard.fleet_read intentionally excludes beta-dark Staff logins.
        await requireExecutionAllowed({ actor: ctx, action: 'dashboard.read' })
        await requireExecutionAllowed({ actor: ctx, action: 'dashboard.fleet_read' })

        const { dashboardPublicApi, staffPublicApi } = getContainer()
        const accessiblePropertyIds = await staffPublicApi.getAccessiblePropertyIds(
          ctx.organizationId,
          ctx.userId,
          scopeForPermission(ctx, 'dashboard.fleet_read') === 'organization',
        )

        return await dashboardPublicApi.getSetupChecklist({
          organizationId: ctx.organizationId,
          role: ctx.role,
          accessiblePropertyIds,
          allowedActions: {
            manageGoogle: canForContext(ctx, 'integration.manage'),
            importProperty: canForContext(ctx, 'property.import_gbp_v2'),
            createPortal: canForContext(ctx, 'portal.create'),
            // The action opens Property responsibility settings, whose command
            // authority is `property.update` (not the broader people lifecycle).
            assignManagers: canForContext(ctx, 'property.update'),
          },
        })
      } catch (error) {
        if (isDashboardError(error)) {
          throwContextError(
            'DashboardError',
            error,
            setupChecklistErrorStatus(error.code),
          )
        }
        throw catchUntagged(error)
      }
    },
    'GET',
    'dashboard.getSetupChecklist',
  ),
)
