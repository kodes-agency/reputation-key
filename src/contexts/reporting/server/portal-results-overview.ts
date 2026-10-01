// Reporting — the Portals overview's results, for one Property's Portals or, with
// no Property named, for every Portal of the Organization the caller may read.
// Per architecture: "Server functions are the HTTP entry points into a context."
//
// The roster is Portal's: it is the list the caller may see (`portal.read`,
// scoped to their Properties), with the group each Portal is in today. The
// numbers are Reporting's, read through the Property's own time zone exactly as
// a Portal's own Results view reads them. Nothing about which Portals exist, or
// where they sit, is taken from the browser.
//
// The Organization read is the All properties page. A Property counts only if the
// caller may read both its Portals and its results, so each is asked per Property
// before anything is read; the rest of the Organization is answered as if the
// refused Property did not exist.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  getExecutionPolicy,
  requireExecutionAllowed,
} from '#/shared/auth/execution-policy'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { HTTP_STATUS } from '#/shared/http/status'
import { portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import { getPortalResultsOverviewDto } from '../application/dto/dashboard.dto'
import type {
  PortalResultsRosterEntry,
  PortalResultsTimeRange,
} from '../application/public-api'
import { isDashboardError } from '../domain/dashboard-errors'
import { assertDashboardPropertyAccessible } from './assert-property-access'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import { organizationRoster, readablePropertyIds } from './portal-results-roster'
import { dashboardErrorStatus } from './dashboard-error-status'

/** A refusal Portal tagged while listing its own Portals. Reporting does not import Portal's
 *  error types; it reads the shape and answers with the status a caller expects. */
type PortalListError = Readonly<{ _tag: 'PortalError'; code: string; message: string }>

function isPortalListError(e: unknown): e is PortalListError {
  if (typeof e !== 'object' || e === null) return false
  const { _tag, code, message } = e as Partial<PortalListError>
  return _tag === 'PortalError' && typeof code === 'string' && typeof message === 'string'
}

function portalListErrorStatus(code: string): number {
  if (code === 'forbidden') return HTTP_STATUS.FORBIDDEN
  return code.endsWith('_not_found') ? HTTP_STATUS.NOT_FOUND : HTTP_STATUS.SERVER_ERROR
}

type OverviewRequest = Readonly<{
  timeRange: PortalResultsTimeRange
  compare: boolean
}>

async function readProperty(
  rawPropertyId: string,
  request: OverviewRequest,
  ctx: AuthContext,
) {
  await requireExecutionAllowed({
    actor: ctx,
    action: 'portal.read',
    capability: 'portal.read',
    propertyId: rawPropertyId,
  })
  await requireExecutionAllowed({
    actor: ctx,
    action: 'dashboard.read',
    propertyId: rawPropertyId,
  })
  const { dashboardPublicApi, portalPublicApi, propertyPublicApi, identityPublicApi } =
    getContainer()
  // D6-001: non-admin callers may only read their assigned properties.
  await assertDashboardPropertyAccessible(identityPublicApi.people, ctx, rawPropertyId)
  const pid = propertyId(rawPropertyId)
  const [rows, timezone] = await Promise.all([
    portalPublicApi.management.listPortalOverview(
      { scope: 'property', propertyId: rawPropertyId },
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
    timeRange: request.timeRange,
    compare: request.compare,
  })
}

async function readOrganization(request: OverviewRequest, ctx: AuthContext) {
  // The Organization-level answer first: a role or posture that cannot read
  // either surface at all is refused as one, before any Property is looked at.
  await requireExecutionAllowed({
    actor: ctx,
    action: 'portal.read',
    capability: 'portal.read',
  })
  await requireExecutionAllowed({ actor: ctx, action: 'dashboard.read' })
  const {
    clock,
    dashboardPublicApi,
    portalPublicApi,
    propertyPublicApi,
    identityPublicApi,
  } = getContainer()
  const organizationId = ctx.organizationId
  const observedAt = clock()
  const allowed = (action: 'portal.read' | 'dashboard.read') => async (id: string) =>
    (
      await getExecutionPolicy().decide({
        principal: { kind: 'user', ctx },
        action,
        capability: action === 'portal.read' ? 'portal.read' : undefined,
        organizationId,
        propertyId: id,
        executionKind: 'interactive',
        now: observedAt,
      })
    ).allowed
  // D6-001: non-admin callers may only read their assigned Properties. Asked once
  // for the whole Organization (null: an Organization-wide caller), then applied
  // by membership, so no Property costs a lookup of its own.
  const assignedIds = await getAccessiblePropertyIdsForPermission(
    (orgId, userId, orgWide) =>
      identityPublicApi.people.getAccessiblePropertyIds(orgId, userId, orgWide),
    ctx,
    'dashboard.read',
  )
  const assigned = new Set<string>(assignedIds ?? [])
  const inScope = (id: string): boolean => assignedIds === null || assigned.has(id)
  const candidateIds = (
    await portalPublicApi.management.listPortalManagementPropertyIds(organizationId)
  ).filter(inScope)
  const propertyIds = await readablePropertyIds(candidateIds, [
    allowed('portal.read'),
    allowed('dashboard.read'),
  ])
  const rows = await portalPublicApi.management.listPortalOverview(
    { scope: 'organization', propertyIds },
    ctx,
  )
  const listed = [...new Set(rows.map((row) => row.propertyId as string))]
  const zones = new Map<string, string | null>(
    (
      await propertyPublicApi.getPropertyTimezones(organizationId, listed.map(propertyId))
    ).map(({ id, timezone }) => [id, timezone]),
  )
  const { portals, properties } = organizationRoster(rows, zones)
  return await dashboardPublicApi.getPortalResultsOverview({
    scope: { organizationId, propertyId: null },
    portals,
    properties,
    timeRange: request.timeRange,
    compare: request.compare,
  })
}

export const getPortalResultsOverviewFn = createServerFn({ method: 'GET' })
  .validator(getPortalResultsOverviewDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const ctx = await resolveTenantContext(await headersFromContext())
          return data.propertyId
            ? await readProperty(data.propertyId, data, ctx)
            : await readOrganization(data, ctx)
        } catch (e) {
          if (isDashboardError(e))
            throwContextError('DashboardError', e, dashboardErrorStatus(e.code))
          if (isPortalListError(e))
            throwContextError('PortalError', e, portalListErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'dashboard.getPortalResultsOverview',
    ),
  )
