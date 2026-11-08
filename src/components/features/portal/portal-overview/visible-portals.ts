import type { PortalOverviewRow } from '#/contexts/portal/application/portal-management-contracts'
export function visiblePortals(
  rows: readonly PortalOverviewRow[],
): readonly PortalOverviewRow[] {
  return rows.filter(
    (row) => row.kind !== 'personal' || row.publicationState !== 'archived',
  )
}
