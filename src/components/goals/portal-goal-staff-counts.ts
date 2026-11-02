import type { PortalGoalPortalCount } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
export function staffPortalCounts(
  rows: readonly PortalGoalPortalCount[],
): readonly PortalGoalPortalCount[] {
  const staff = rows.filter((row) => row.kind === 'personal')
  if (!staff.length) return rows
  return [
    ...rows.filter((row) => row.kind !== 'personal'),
    {
      portalId: 'staff-portals',
      name: `Staff portals: ${staff.length}`,
      count: staff.reduce((sum, row) => sum + row.count, 0),
    },
  ]
}
