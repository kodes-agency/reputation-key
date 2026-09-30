// The head of a group in the overview: a button that folds the group's Portals
// away, the group's name and how many Portals it holds. The group's own page
// arrives with slice 38, so the name is not a link yet; Portal Group management
// stays below the table until then.
import { ChevronDown, ChevronRight } from 'lucide-react'
import { TableHead, TableRow } from '#/components/ui/table'
import { TableCell } from '#/components/ui/table'
import { PortalMeasureCells } from './portal-overview-measure-cells'
import { groupHeadCount, type MeasureSlot } from './portal-overview-results'
import { PORTAL_OVERVIEW_COLUMNS } from './portal-overview-table-row'
import { describeGroupCount, type PortalOverviewSection } from './portal-overview-view'

type Props = Readonly<{
  section: PortalOverviewSection
  /** The group's own figures: its scans, ratings, average, Google opens and notes. */
  figures: MeasureSlot
  /** How many Portals the results count in the group today; null until they arrive. */
  readCount: number | null
  expanded: boolean
  onToggle: () => void
}>

const NOT_IN_A_GROUP = 'Not in a group'

export function PortalOverviewGroupHead({
  section,
  figures,
  readCount,
  expanded,
  onToggle,
}: Props) {
  const name = section.group?.name ?? NOT_IN_A_GROUP
  const { members, matched } = groupHeadCount(section, readCount)
  const summary = figures.kind === 'figures' ? figures.measures.summary : null
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <TableRow className="block border-0 bg-transparent px-1 pt-2 hover:bg-transparent @4xl:table-row @4xl:border-b @4xl:bg-muted/40 @4xl:px-0 @4xl:pt-0 @4xl:hover:bg-muted/40">
      <TableHead
        scope="rowgroup"
        colSpan={figures.kind === 'off' ? PORTAL_OVERVIEW_COLUMNS : 1}
        className="block h-auto p-0 text-left font-normal @4xl:table-cell @4xl:px-2 @4xl:py-2"
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
        <span className="font-medium">{name}</span>
        <span className="text-sm text-muted-foreground">
          {' '}
          · {describeGroupCount(members, matched)}
        </span>
        {summary ? (
          <span className="block pl-10 text-sm text-muted-foreground md:pl-8 @4xl:hidden">
            {summary}
          </span>
        ) : null}
      </TableHead>
      <PortalMeasureCells slot={figures} strong />
      {figures.kind === 'off' ? null : (
        <TableCell
          colSpan={PORTAL_OVERVIEW_COLUMNS - 1}
          className="hidden @4xl:table-cell"
        />
      )}
    </TableRow>
  )
}
