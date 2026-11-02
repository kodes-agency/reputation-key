import { queryOptions, useQueries } from '@tanstack/react-query'
import { useStaffFunctions, type StaffAccountFunctions } from './staff-account-functions'
import { staffKeys } from '#/shared/queries/query-keys'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { withStaffSetupRows } from './staff-overview-rows'
export const staffAccountsQuery = (
  propertyId: string,
  list: StaffAccountFunctions['listStaffMembers'],
) =>
  queryOptions({
    queryKey: staffKeys.accounts(propertyId),
    queryFn: () => list({ data: { propertyId } }),
    staleTime: 30_000,
  })
/** All properties shares the same cached Property reads as its row providers. */
export function useStaffOverviewRows(
  rows: readonly PortalOverviewRow[],
  properties: readonly Readonly<{ id: string }>[],
) {
  const functions = useStaffFunctions()
  const { all } = useCapabilities()
  const { can } = usePermissions()
  const enabled = all.includes('staff.accounts') && can('staff.read')
  const rosters = useQueries({
    queries: enabled
      ? properties.map((p) => staffAccountsQuery(p.id, functions.listStaffMembers))
      : [],
  })
  return properties.reduce<readonly PortalOverviewRow[]>(
    (listed, property, index) =>
      withStaffSetupRows(listed, rosters[index]?.data?.members ?? [], property.id),
    rows,
  )
}
