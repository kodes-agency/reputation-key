// Reporting — the Portals overview's results, for one Property's Portals.
// Per architecture: "Server functions are the HTTP entry points into a context."
//
// The roster is Portal's: it is the list the caller may see (`portal.read`,
// scoped to their Properties), with the group each Portal is in today. The
// numbers are Reporting's, read through the Property's own time zone exactly as
// a Portal's own Results view reads them. Nothing about which Portals exist, or
// where they sit, is taken from the browser.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { standardErrorStatus as dashboardErrorStatus } from '#/shared/http/status'
import { portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import { getPortalResultsOverviewDto } from '../application/dto/dashboard.dto'
import type { PortalResultsRosterEntry } from '../application/public-api'
import { isDashboardError } from '../domain/dashboard-errors'
import { assertDashboardPropertyAccessible } from './assert-property-access'

export const getPortalResultsOverviewFn = createServerFn({ method: 'GET' })
  .validator(getPortalResultsOverviewDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const ctx = await resolveTenantContext(await headersFromContext())
          await requireExecutionAllowed({
            actor: ctx,
            action: 'portal.read',
            capability: 'portal.read',
            propertyId: data.propertyId,
          })
          await requireExecutionAllowed({
            actor: ctx,
            action: 'dashboard.read',
            propertyId: data.propertyId,
          })
          const {
            dashboardPublicApi,
            portalPublicApi,
            propertyPublicApi,
            identityPublicApi,
          } = getContainer()
          // D6-001: non-admin callers may only read their assigned properties.
          await assertDashboardPropertyAccessible(
            identityPublicApi.people,
            ctx,
            data.propertyId,
          )
          const pid = propertyId(data.propertyId)
          const [rows, timezone] = await Promise.all([
            portalPublicApi.management.listPortalOverview(
              { scope: 'property', propertyId: data.propertyId },
              ctx,
            ),
            propertyPublicApi.getPropertyTimezone(ctx.organizationId, pid),
          ])
          if (!timezone) {
            // Server helpers construct the public error shape without importing a
            // domain error constructor across the server/domain boundary.
            throw {
              _tag: 'DashboardError' as const,
              code: 'not_found' as const,
              message: 'Property timezone unavailable',
            }
          }
          const portals: PortalResultsRosterEntry[] = rows.map((row) => ({
            portalId: portalId(row.portalId),
            propertyId: pid,
            groupId: row.group ? portalGroupId(row.group.id) : null,
          }))
          return await dashboardPublicApi.getPortalResultsOverview({
            scope: { organizationId: ctx.organizationId, propertyId: pid },
            portals,
            properties: [{ propertyId: pid, timezone }],
            timeRange: data.timeRange,
            compare: data.compare,
          })
        } catch (e) {
          if (isDashboardError(e))
            throwContextError('DashboardError', e, dashboardErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'dashboard.getPortalResultsOverview',
    ),
  )
