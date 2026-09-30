// The Portals overview as one table with one `<tbody>` per group. Below a 56 rem
// container each row is a card and the header row is not shown; from 56 rem it
// is a table (see `portal-overview-table-row.tsx`). Groups fold away; the fold is the
// reader's own, kept here rather than in the URL.
import { useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import type { PortalArchiveMutations } from './portal-archive-dialog'
import { PortalOverviewGroupHead } from './portal-overview-group-head'
import { MEASURE_COLUMNS } from './portal-overview-measure-cells'
import {
  groupSlot,
  measureSlot,
  type PortalOverviewResultsState,
} from './portal-overview-results'
import type { SortDirection } from './portal-overview-search-schema'
import { PortalOverviewTableRow } from './portal-overview-table-row'
import type { PortalOverviewSection } from './portal-overview-view'

type Props = PortalArchiveMutations &
  Readonly<{
    sections: readonly PortalOverviewSection[]
    propertyId: string
    propertyName: string
    results: PortalOverviewResultsState
    /** Set while the table is ordered by qualified scans, to mark that column. */
    scansOrder?: SortDirection
  }>

const TBODY = 'block space-y-3 pb-3 @4xl:table-row-group @4xl:space-y-0 @4xl:pb-0'

const MEASURE_HEAD = 'h-10 px-2 text-right text-xs text-muted-foreground'

function MeasureHeader({
  label,
  order,
}: Readonly<{ label: string; order: SortDirection | undefined }>) {
  const Arrow = order === 'asc' ? ArrowUp : ArrowDown
  return (
    <TableHead
      scope="col"
      aria-sort={
        order === undefined ? undefined : order === 'asc' ? 'ascending' : 'descending'
      }
      className={MEASURE_HEAD}
    >
      {order === undefined ? null : (
        <Arrow aria-hidden="true" className="mr-1 inline size-3 align-[-1px]" />
      )}
      {label}
    </TableHead>
  )
}

export function PortalOverviewTable({
  sections,
  propertyId,
  propertyName,
  archiveMutation,
  restoreMutation,
  results,
  scansOrder,
}: Props) {
  const [folded, setFolded] = useState<readonly string[]>([])
  const toggle = (key: string) =>
    setFolded((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    )

  return (
    <div className="@container @4xl:overflow-hidden @4xl:rounded-lg @4xl:border @4xl:bg-card">
      <Table aria-label={`Portals at ${propertyName}`} className="block @4xl:table">
        <TableHeader className="hidden @4xl:table-header-group">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="h-10 px-4 text-xs text-muted-foreground">
              Portal
            </TableHead>
            {results.status === 'off'
              ? null
              : MEASURE_COLUMNS.map(({ key, label }) => (
                  <MeasureHeader
                    key={key}
                    label={label}
                    order={key === 'scans' ? scansOrder : undefined}
                  />
                ))}
            <TableHead scope="col" className="h-10 px-4 text-xs text-muted-foreground">
              Responsible
            </TableHead>
            <TableHead scope="col" colSpan={2} className="h-10 px-2">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        {sections.map((section) => {
          const headed = section.kind !== 'flat'
          const expanded = !headed || !folded.includes(section.key)
          const head = groupSlot(results, (index) =>
            section.group ? index.group(section.group.id) : index.ungrouped(propertyId),
          )
          return (
            <TableBody key={section.key} className={TBODY}>
              {headed ? (
                <PortalOverviewGroupHead
                  section={section}
                  figures={head.slot}
                  readCount={head.memberCount}
                  expanded={expanded}
                  onToggle={() => toggle(section.key)}
                />
              ) : null}
              {expanded
                ? section.items.map((item) => (
                    <PortalOverviewTableRow
                      key={item.row.portalId}
                      item={item}
                      figures={measureSlot(results, (index) =>
                        index.portal(item.row.portalId),
                      )}
                      propertyId={propertyId}
                      showGroup={!headed}
                      archiveMutation={archiveMutation}
                      restoreMutation={restoreMutation}
                    />
                  ))
                : null}
            </TableBody>
          )
        })}
      </Table>
    </div>
  )
}
