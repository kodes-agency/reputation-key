import { useQuery } from '@tanstack/react-query'
import { portalKeys } from '#/shared/queries/query-keys'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { useStaffFunctions } from './staff-account-functions'
import type { PortalResultsTimeRange } from '#/contexts/reporting/application/public-api'

export function useStaffResults(
  propertyId: string,
  period: PortalResultsTimeRange = 'month',
) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const functions = useStaffFunctions()
  return useQuery({
    queryKey: portalKeys.resultsOverview(propertyId, period, false),
    enabled:
      Boolean(propertyId) &&
      can('dashboard.read') &&
      can('portal.read') &&
      has('portal.read'),
    queryFn: () =>
      functions.getPortalResultsOverviewFn({
        data: { propertyId, timeRange: period, compare: false },
      }),
  })
}
