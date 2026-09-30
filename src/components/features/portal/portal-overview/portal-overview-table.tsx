// The Portals overview as one table with one `<tbody>` per group. Below a 56 rem
// container each row is a card and the header row is not shown; from 56 rem it
// is a table (see `portal-overview-row.tsx`). Groups fold away; the fold is the
// reader's own, kept here rather than in the URL.
import { useState } from 'react'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import type { PortalArchiveMutations } from './portal-archive-dialog'
import { PortalOverviewGroupHead } from './portal-overview-group-head'
import { PortalOverviewRow } from './portal-overview-row'
import type { PortalOverviewSection } from './portal-overview-view'

type Props = PortalArchiveMutations &
  Readonly<{
    sections: readonly PortalOverviewSection[]
    propertyId: string
    propertyName: string
  }>

const TBODY = 'block space-y-3 pb-3 @4xl:table-row-group @4xl:space-y-0 @4xl:pb-0'

export function PortalOverviewTable({
  sections,
  propertyId,
  propertyName,
  archiveMutation,
  restoreMutation,
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
          return (
            <TableBody key={section.key} className={TBODY}>
              {headed ? (
                <PortalOverviewGroupHead
                  section={section}
                  expanded={expanded}
                  onToggle={() => toggle(section.key)}
                />
              ) : null}
              {expanded
                ? section.items.map((item) => (
                    <PortalOverviewRow
                      key={item.row.portalId}
                      item={item}
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
