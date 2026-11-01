import type {
  GetPortalAnalyticsDeps,
  GetPortalAnalyticsInput,
} from './get-portal-analytics'
import type { AuthContext } from '#/shared/domain/auth-context'
import { requireDashboardPropertyAccess } from '../dashboard-property-access'

/** An optional editor side read, authorised exactly as the Results read. */
export const getPortalLinkTaps =
  (
    deps: Readonly<{
      portalMetrics: Pick<
        GetPortalAnalyticsDeps['portalMetrics'],
        'getPortalLinkTapCounts'
      >
      propertyAccess: GetPortalAnalyticsDeps['propertyAccess']
    }>,
  ) =>
  async (
    input: Pick<
      GetPortalAnalyticsInput,
      'organizationId' | 'propertyId' | 'portalId' | 'startDate' | 'endDate'
    >,
    ctx: AuthContext,
  ) => {
    await requireDashboardPropertyAccess(deps.propertyAccess, ctx, {
      organizationId: input.organizationId,
      propertyIds: [input.propertyId],
    })
    const rows = await deps.portalMetrics.getPortalLinkTapCounts({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      portalId: input.portalId,
      startAt: input.startDate,
      endAt: input.endDate,
    })
    return {
      windowDays: 30 as const,
      taps: Object.fromEntries(rows.map((row) => [row.linkId, row.taps])),
    }
  }
