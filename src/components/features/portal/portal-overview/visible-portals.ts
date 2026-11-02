import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
export function visiblePortals(
  rows: readonly PortalOverviewRow[],
): readonly PortalOverviewRow[] {
  return rows.filter(
    (row) => row.kind !== 'personal' || row.publicationState !== 'archived',
  )
}
