// The All properties table (board 10): one `<tbody>` per Property, headed by the
// Property's own subtotal, and under it that Property's Portals (in its groups,
// when it has groups). The same row, group head and header as the Portals page of
// one Property, so a Portal reads the same in both. A folded Property stays
// folded for the reader (`collapsed-properties-store`); a group's fold is local.
import { useState } from 'react'
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
    properties: readonly PortalPropertySection[]
    results: PortalOverviewResultsState
    /** A new window is loading: the figures shown are still the previous window's. */
    busy?: boolean
    /** Set while the table is ordered by qualified scans, to mark that column. */
    scansOrder?: SortDirection
    /** The Properties the reader folded. */
    collapsed: readonly string[]
    onToggleProperty: (propertyId: string) => void
  }>

export function PortalAllPropertiesTable({
  properties,
  results,
  busy = false,
  scansOrder,
  collapsed,
  onToggleProperty,
  archiveMutation,
  restoreMutation,
  disableMutation,
}: Props) {
  const [foldedGroups, setFoldedGroups] = useState<readonly string[]>([])
  const toggleGroup = (key: string) =>
    setFoldedGroups((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    )

  return (
    <DataTable label="Portals at all properties" layout="cards" busy={busy}>
      <PortalOverviewTableHead results={results} scansOrder={scansOrder} />
      {properties.map((property) => {
        const expanded = !collapsed.includes(property.propertyId)
        const head = groupSlot(results, (index) => index.property(property.propertyId))
        return (
          // As cards, a rule above each Property but the first: where one ends and the next begins.
          <DataTableBody
            key={property.propertyId}
            className="@max-4xl:mt-6 @max-4xl:border-t @max-4xl:pt-4 @max-4xl:first-of-type:mt-0 @max-4xl:first-of-type:border-t-0 @max-4xl:first-of-type:pt-0"
          >
            <PortalOverviewPropertyHead
              property={property}
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
                      expanded={
                        section.kind === 'flat' || !foldedGroups.includes(groupKey)
                      }
                      onToggle={() => toggleGroup(groupKey)}
                      nested
                      archiveMutation={archiveMutation}
                      restoreMutation={restoreMutation}
                      disableMutation={disableMutation}
                    />
                  )
                })
              : null}
          </DataTableBody>
        )
      })}
    </DataTable>
  )
}
