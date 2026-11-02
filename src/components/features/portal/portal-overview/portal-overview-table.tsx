// The Portals overview as one table with one `<tbody>` per group. Below a 56 rem
// container each row is a card and the header row is not shown; from 56 rem it
// is a table (see `portal-overview-table-row.tsx`). Groups fold away; the fold is the
// reader's own, kept here rather than in the URL.
import { StaffAccountsProvider } from '#/components/features/staff/accounts/staff-accounts-provider'
import { sectionExpanded } from './portal-staff-sections'
import { useState, type ReactNode } from 'react'
import { DataTable, DataTableBody } from '#/components/ui/data-table'
import type { PortalArchiveMutations } from './portal-archive-dialog'
import type { PortalOverviewResultsState } from './portal-overview-results'
import { PortalOverviewSectionRows } from './portal-overview-section-rows'
import type { SortDirection } from '#/components/ui/list-sort'
import {
  OVERVIEW_FROM,
  OverviewDensityProvider,
  type OverviewDensity,
} from './portal-overview-density'
import { PortalOverviewTableHead } from './portal-overview-table-head'
import type { PortalOverviewItem, PortalOverviewSection } from './portal-overview-view'

type Props = PortalArchiveMutations &
  Readonly<{
    folded?: Readonly<Record<string, boolean>>
    onToggleSection?: (section: PortalOverviewSection) => void
    sections: readonly PortalOverviewSection[]
    propertyId: string
    propertyName: string
    results: PortalOverviewResultsState
    /** A new window is loading: the figures shown are still the previous window's. */
    busy?: boolean
    /** Set while the table is ordered by scans, to mark that column. */
    scansOrder?: SortDirection
    /** A group's actions menu, drawn in its head. Left out, groups have none. */
    groupActions?: (group: NonNullable<PortalOverviewSection['group']>) => ReactNode
    /** Extra entries in each Portal's "more actions" menu (the group page's "Remove"). */
    rowMenuExtra?: (item: PortalOverviewItem) => ReactNode
    /** Say which group each Portal is in. Default: only in a flat list, which has no heads. */
    showGroup?: boolean
    /** `compact` is a table from 42 rem rather than 56 rem, for a narrower column (a group's page). */
    density?: OverviewDensity
  }>

export function PortalOverviewTable({
  sections,
  folded: controlledFolded,
  onToggleSection,
  propertyId,
  propertyName,
  archiveMutation,
  restoreMutation,
  disableMutation,
  results,
  busy = false,
  scansOrder,
  groupActions,
  rowMenuExtra,
  showGroup,
  density = 'regular',
}: Props) {
  const [localFolded, setFolded] = useState<Readonly<Record<string, boolean>>>({})
  const folded = controlledFolded ?? localFolded
  const toggle = (section: PortalOverviewSection) =>
    onToggleSection
      ? onToggleSection(section)
      : setFolded((current) => ({
          ...current,
          [section.key]: sectionExpanded(section, current[section.key]),
        }))

  return (
    <StaffAccountsProvider propertyId={propertyId}>
      <OverviewDensityProvider value={density}>
        <DataTable
          label={`Portals at ${propertyName}`}
          from={OVERVIEW_FROM[density]}
          layout="cards"
          busy={busy}
        >
          <PortalOverviewTableHead results={results} scansOrder={scansOrder} />
          {sections.map((section) => (
            <DataTableBody key={section.key}>
              <PortalOverviewSectionRows
                section={section}
                propertyId={propertyId}
                results={results}
                expanded={sectionExpanded(section, folded[section.key])}
                onToggle={() => toggle(section)}
                groupActions={groupActions}
                rowMenuExtra={rowMenuExtra}
                showGroup={showGroup}
                archiveMutation={archiveMutation}
                restoreMutation={restoreMutation}
                disableMutation={disableMutation}
              />
            </DataTableBody>
          ))}
        </DataTable>
      </OverviewDensityProvider>
    </StaffAccountsProvider>
  )
}
