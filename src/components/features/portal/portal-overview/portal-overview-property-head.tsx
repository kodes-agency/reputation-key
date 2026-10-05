// The head of a Property in the All properties table (board 10): a button that
// folds the Property's Portals away, its name (the way into its own Portals
// page), how many Portals it holds, and its own subtotal of the five measures,
// read through the Property's own days. A quiet notice says when its Google link
// needs attention; nothing is said when it does not.
import { Link } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { RowActionsItem, RowActionsMenu } from '#/components/ui/row-actions-menu'
import { ROW_NAME_LINK } from '#/components/ui/row-link'
import { TableCell, TableHead, TableRow } from '#/components/ui/table'
import { cn } from '#/lib/utils'
import { PortalMeasureCells } from './portal-overview-measure-cells'
import { groupHeadCount, type MeasureSlot } from './portal-overview-results'
import { PORTAL_OVERVIEW_COLUMNS } from './portal-overview-table-row'
import type { PortalPropertySection } from './portal-all-properties-view'
import { describeGroupCount } from './portal-overview-view'
import { PortalOverviewToggle } from './portal-overview-toggle'

type Props = Readonly<{
  property: PortalPropertySection
  /** The Property's own subtotal: its scans, ratings, average, Google opens and notes. */
  figures: MeasureSlot
  /** How many Portals the results count in the Property; null until they arrive. */
  readCount: number | null
  expanded: boolean
  onToggle: () => void
}>

function PropertyMenu({ property }: Readonly<{ property: PortalPropertySection }>) {
  const params = { propertyId: property.propertyId }
  return (
    <RowActionsMenu name={property.name}>
      <RowActionsItem asChild>
        <Link to="/properties/$propertyId/portals" params={params}>
          Open portals
        </Link>
      </RowActionsItem>
      <RowActionsItem asChild>
        <Link to="/properties/$propertyId" params={params}>
          Open dashboard
        </Link>
      </RowActionsItem>
      <RowActionsItem asChild>
        <Link to="/properties/$propertyId/settings" params={params}>
          Property settings
        </Link>
      </RowActionsItem>
    </RowActionsMenu>
  )
}

function GoogleNotice({ text }: Readonly<{ text: string }>) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-warn">
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
      {text}
    </span>
  )
}

export function PortalOverviewPropertyHead({
  property,
  figures,
  readCount,
  expanded,
  onToggle,
}: Props) {
  const { name, googleNotice } = property
  const { members, matched } = groupHeadCount(property, readCount)
  const summary = figures.kind === 'figures' ? figures.measures.summary : null
  return (
    <TableRow
      className={cn(
        'block border-0 bg-transparent px-1 pt-2 hover:bg-transparent',
        '@4xl:table-row @4xl:border-b @4xl:bg-muted/60 @4xl:px-0 @4xl:pt-0 @4xl:hover:bg-muted/60',
      )}
    >
      <TableHead
        scope="rowgroup"
        className="block h-auto p-0 text-left font-normal @4xl:table-cell @4xl:px-2 @4xl:py-2.5"
      >
        <PortalOverviewToggle name={name} expanded={expanded} onToggle={onToggle} />
        <Link
          to="/properties/$propertyId/portals"
          params={{ propertyId: property.propertyId }}
          className={cn('font-semibold', ROW_NAME_LINK)}
        >
          {name}
        </Link>
        <span className="text-sm text-muted-foreground">
          {' '}
          · {describeGroupCount(members, matched)}
        </span>
        {summary ? (
          <span className="block pl-10 text-sm text-muted-foreground md:pl-8 @4xl:hidden">
            {summary}
          </span>
        ) : null}
        {googleNotice ? (
          <span className="block pl-10 md:pl-8 @4xl:hidden">
            <GoogleNotice text={googleNotice} />
          </span>
        ) : null}
      </TableHead>
      <PortalMeasureCells slot={figures} strong />
      <TableCell
        colSpan={PORTAL_OVERVIEW_COLUMNS - 1}
        className="hidden px-2 py-1 @4xl:table-cell"
      >
        <div className="flex items-center justify-end gap-2">
          {googleNotice ? <GoogleNotice text={googleNotice} /> : null}
          <PropertyMenu property={property} />
        </div>
      </TableCell>
    </TableRow>
  )
}
