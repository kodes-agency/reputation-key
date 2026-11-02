// The All properties table (board 10): one `<tbody>` per Property, headed by the
// Property's own subtotal, and under it that Property's Portals (in its groups,
// when it has groups). The same row, group head and header as the Portals page of
// one Property, so a Portal reads the same in both. A folded Property stays
// folded for the reader (`collapsed-properties-store`); a group's fold is local.
import { StaffAccountsProvider } from '#/components/features/staff/accounts/staff-accounts-provider'
import type { PortalOverviewSection } from './portal-overview-view'
import { sectionExpanded } from './portal-staff-sections'
import { DataTable, DataTableBody } from '#/components/ui/data-table'
import type { PortalArchiveMutations } from './portal-archive-dialog'
import type { PortalPropertySection } from './portal-all-properties-view'
import { PortalOverviewPropertyHead } from './portal-overview-property-head'
import { groupSlot, type PortalOverviewResultsState } from './portal-overview-results'
import { PortalOverviewSectionRows } from './portal-overview-section-rows'
import type { SortDirection } from '#/components/ui/list-sort'
import { PortalOverviewTableHead } from './portal-overview-table-head'

type Props = PortalArchiveMutations &
  Readonly<{
    foldedGroups: Readonly<Record<string, boolean>>
    onToggleGroup: (key: string, section: PortalOverviewSection) => void
    properties: readonly PortalPropertySection[]
    results: PortalOverviewResultsState
    /** A new window is loading: the figures shown are still the previous window's. */
    busy?: boolean
    /** Set while the table is ordered by scans, to mark that column. */
    scansOrder?: SortDirection
    /** The Properties the reader folded. */
    collapsed: readonly string[]
    onToggleProperty: (propertyId: string) => void
  }>

export function PortalAllPropertiesTable({
  properties,
  foldedGroups,
  onToggleGroup,
  results,
  busy = false,
  scansOrder,
  collapsed,
  onToggleProperty,
  archiveMutation,
  restoreMutation,
  disableMutation,
}: Props) {
  return (
    <DataTable label="Portals at all properties" layout="cards" busy={busy}>
      <PortalOverviewTableHead results={results} scansOrder={scansOrder} />
      {properties.map((property, position) => {
        const expanded = !collapsed.includes(property.propertyId)
        const head = groupSlot(results, (index) => index.property(property.propertyId))
        return (
          <StaffAccountsProvider
            key={property.propertyId}
            propertyId={property.propertyId}
            inTable
          >
            <DataTableBody>
              <PortalOverviewPropertyHead
                property={property}
                divided={position > 0}
                figures={head.slot}
                readCount={head.memberCount}
                expanded={expanded}
                onToggle={() => onToggleProperty(property.propertyId)}
              />
              {expanded
                ? property.sections.map((section) => {
                    const groupKey = `${property.propertyId}/${section.key}`
                    return (
                      <PortalOverviewSectionRows
                        key={groupKey}
                        section={section}
                        propertyId={property.propertyId}
                        results={results}
                        expanded={sectionExpanded(section, foldedGroups[groupKey])}
                        onToggle={() => onToggleGroup(groupKey, section)}
                        nested
                        archiveMutation={archiveMutation}
                        restoreMutation={restoreMutation}
                        disableMutation={disableMutation}
                      />
                    )
                  })
                : null}
            </DataTableBody>
          </StaffAccountsProvider>
        )
      })}
    </DataTable>
  )
}
