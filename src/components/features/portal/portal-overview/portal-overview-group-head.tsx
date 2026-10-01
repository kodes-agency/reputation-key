// The head of a group in the overview: a button that folds the group's Portals
// away, the group's name (a link to the group's page) and how many Portals it
// holds, its figures, and the group's actions menu. The ungrouped head is not a
// group: it has no page and no menu.
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { TableCell, TableHead, TableRow } from '#/components/ui/table'
import { cn } from '#/lib/utils'
import { useOverviewClasses } from './portal-overview-density'
import { PortalMeasureCells } from './portal-overview-measure-cells'
import { groupHeadCount, type MeasureSlot } from './portal-overview-results'
import { PORTAL_OVERVIEW_COLUMNS } from './portal-overview-table-row'
import { describeGroupCount, type PortalOverviewSection } from './portal-overview-view'

type Props = Readonly<{
  propertyId: string
  /** The group's actions menu; the ungrouped head has none. */
  actions?: ReactNode
  section: PortalOverviewSection
  /** The group's own figures: its scans, ratings, average, Google opens and notes. */
  figures: MeasureSlot
  /** How many Portals the results count in the group today; null until they arrive. */
  readCount: number | null
  expanded: boolean
  onToggle: () => void
  /** Under a Property's head: indented, and without the shade the Property's head has. */
  nested?: boolean
}>

const NOT_IN_A_GROUP = 'Not in a group'

export function PortalOverviewGroupHead({
  propertyId,
  actions,
  section,
  figures,
  readCount,
  expanded,
  onToggle,
  nested = false,
}: Props) {
  const classes = useOverviewClasses()
  const name = section.group?.name ?? NOT_IN_A_GROUP
  const { members, matched } = groupHeadCount(section, readCount)
  const summary = figures.kind === 'figures' ? figures.measures.summary : null
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <TableRow
      className={cn(
        classes.groupRow,
        // Under a Property's head the group is lighter: no shade of its own.
        nested && '@4xl:bg-transparent @4xl:hover:bg-transparent',
      )}
    >
      <TableHead
        // Under a Property's head the Property is the rowgroup header; a group's own
        // head covers only its row, not the Portals of the groups beside it.
        scope={nested ? 'row' : 'rowgroup'}
        colSpan={figures.kind === 'off' ? PORTAL_OVERVIEW_COLUMNS - 1 : 1}
        className={cn(classes.groupName, nested && '@4xl:pl-8')}
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
        {section.group ? (
          <Link
            to="/properties/$propertyId/portals/groups/$groupId"
            params={{ propertyId, groupId: section.group.id }}
            className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {name}
          </Link>
        ) : (
          <span className="font-medium">{name}</span>
        )}
        <span className="text-sm text-muted-foreground">
          {' '}
          · {describeGroupCount(members, matched)}
        </span>
        {summary ? <span className={classes.groupSummary}>{summary}</span> : null}
      </TableHead>
      <PortalMeasureCells slot={figures} strong />
      {figures.kind === 'off' ? null : (
        <TableCell
          colSpan={PORTAL_OVERVIEW_COLUMNS - 2}
          className={classes.groupSpacer}
        />
      )}
      {/* One place for the menu at every width: a corner of the card, a column of the table. */}
      <TableCell className={classes.groupActions}>{actions}</TableCell>
    </TableRow>
  )
}
