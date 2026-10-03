// The head of a Property in the All properties table (board 10): a button that
// folds the Property's Portals away, its name (the way into its own Portals
// page), how many Portals it holds, and its own subtotal of the five measures,
// read through the Property's own days. A quiet notice says when its Google link
// needs attention; nothing is said when it does not.
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, Ellipsis, TriangleAlert } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { TableCell, TableHead, TableRow } from '#/components/ui/table'
import { cn } from '#/lib/utils'
import { PortalMeasureCells } from './portal-overview-measure-cells'
import { groupHeadCount, type MeasureSlot } from './portal-overview-results'
import { PORTAL_OVERVIEW_COLUMNS } from './portal-overview-table-row'
import type { PortalPropertySection } from './portal-all-properties-view'
import { describeGroupCount } from './portal-overview-view'

type Props = Readonly<{
  property: PortalPropertySection
  /** The Property's own subtotal: its scans, ratings, average, Google opens and notes. */
  figures: MeasureSlot
  /** How many Portals the results count in the Property; null until they arrive. */
  readCount: number | null
  expanded: boolean
  onToggle: () => void
}>

// A 44 px target below `md`, 32 px from there up. A link used as a menu item
// takes the menu's ink (`dropdown-menu-item` opts out of the link default).
const ITEM = 'min-h-11 md:min-h-8'
const FOCUS_RING =
  'rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

function PropertyMenu({ property }: Readonly<{ property: PortalPropertySection }>) {
  const params = { propertyId: property.propertyId }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 text-muted-foreground md:size-8"
          aria-label={`More actions for ${property.name}`}
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem asChild className={ITEM}>
          <Link to="/properties/$propertyId/portals" params={params}>
            Open portals
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={ITEM}>
          <Link to="/properties/$propertyId" params={params}>
            Open dashboard
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={ITEM}>
          <Link to="/properties/$propertyId/settings" params={params}>
            Property settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const Chevron = expanded ? ChevronDown : ChevronRight
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
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`Portals in ${name}`}
          onClick={onToggle}
          className="-ml-1 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:size-8"
        >
          <Chevron className="size-4" aria-hidden="true" />
        </button>
        <Link
          to="/properties/$propertyId/portals"
          params={{ propertyId: property.propertyId }}
          className={cn('font-semibold', FOCUS_RING)}
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
