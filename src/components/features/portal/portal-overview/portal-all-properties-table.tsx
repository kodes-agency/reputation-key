// The All properties table (board 10): one `<tbody>` per Property, headed by the
// Property's own subtotal, and under it that Property's Portals (in its groups,
// when it has groups). The same row, group head and header as the Portals page of
// one Property, so a Portal reads the same in both. A folded Property stays
// folded for the reader (`collapsed-properties-store`); a group's fold is local.
import { useState } from 'react'
import { cn } from '#/lib/utils'
import { Table, TableBody } from '#/components/ui/table'
import type { PortalArchiveMutations } from './portal-archive-dialog'
import type { PortalPropertySection } from './portal-all-properties-view'
import { PortalOverviewPropertyHead } from './portal-overview-property-head'
import { groupSlot, type PortalOverviewResultsState } from './portal-overview-results'
import { PortalOverviewSectionRows } from './portal-overview-section-rows'
import type { SortDirection } from './portal-overview-search-schema'
import { PortalOverviewTableHead } from './portal-overview-table-head'
import { SECTION_BODY } from './portal-overview-table-styles'

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
}: Props) {
  const [foldedGroups, setFoldedGroups] = useState<readonly string[]>([])
  const toggleGroup = (key: string) =>
    setFoldedGroups((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    )

  return (
    <div
      aria-busy={busy}
      className={cn(
        '@container transition-opacity @4xl:overflow-hidden @4xl:rounded-lg @4xl:border @4xl:bg-card',
        busy && 'opacity-60',
      )}
    >
      <Table aria-label="Portals at all properties" className="block @4xl:table">
        <PortalOverviewTableHead results={results} scansOrder={scansOrder} />
        {properties.map((property) => {
          const expanded = !collapsed.includes(property.propertyId)
          const head = groupSlot(results, (index) => index.property(property.propertyId))
          return (
            <TableBody key={property.propertyId} className={SECTION_BODY}>
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
                      />
                    )
                  })
                : null}
            </TableBody>
          )
        })}
      </Table>
    </div>
  )
}
