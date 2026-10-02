// One Portal in the overview. One DOM for every width: below a 56 rem container
// a row is a card (name and menu, then Edit and Share); from 56 rem it is a
// table row. The same rule as the Properties list, so a Portal's name renders
// once, which Storybook (no CSS container queries to lean on) and the e2e
// journeys both rely on.
import type { ReactNode } from 'react'
import { TableCell, TableHead, TableRow } from '#/components/ui/table'
import { cn } from '#/lib/utils'
import {
  PortalAttentionLine,
  PortalManagersCell,
  PortalMetaLine,
  PortalNameLink,
} from './portal-overview-cells'
import type { PortalArchiveMutations } from './portal-archive-dialog'
import { useOverviewClasses } from './portal-overview-density'
import { PortalMeasureCells } from './portal-overview-measure-cells'
import type { MeasureSlot } from './portal-overview-results'
import { PortalRowButtons, PortalRowMenu } from './portal-overview-row-actions'
import type { PortalOverviewItem } from './portal-overview-view'

/** Columns a head row spans: Portal, Responsible, the actions, the menu. */
export const PORTAL_OVERVIEW_COLUMNS = 4

type Props = PortalArchiveMutations &
  Readonly<{
    item: PortalOverviewItem
    /** This Portal's figures: drawn beside its name in a table, as one line in a card. */
    figures: MeasureSlot
    propertyId: string
    /** A flat list has no group heads, so the row says which group it is in. */
    showGroup: boolean
    /** Extra entries in the "more actions" menu. */
    menuExtra?: ReactNode
  }>

export function PortalOverviewTableRow({
  item,
  figures,
  propertyId,
  showGroup,
  menuExtra,
  archiveMutation,
  restoreMutation,
  disableMutation,
}: Props) {
  const classes = useOverviewClasses()
  const { row } = item
  const archived = row.publicationState === 'archived'
  const draft = row.publicationState === 'draft'
  // A draft has no results: its card says so by saying nothing, as its table row does.
  const summary = figures.kind === 'figures' && !draft ? figures.measures.summary : null
  return (
    <TableRow className={cn(classes.card, archived && 'opacity-70')}>
      <TableHead scope="row" className={classes.nameCell}>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <PortalNameLink
              row={{ propertyId, portalId: row.portalId, name: row.name }}
            />
            <PortalAttentionLine item={item} propertyId={propertyId} />
          </div>
          <PortalMetaLine item={item} showGroup={showGroup} />
          {summary ? <p className={cn('text-sm', classes.cardOnly)}>{summary}</p> : null}
        </div>
      </TableHead>
      <PortalMeasureCells slot={figures} draft={draft} />
      <TableCell className={classes.managersCell}>
        {archived ? null : <PortalManagersCell managers={item.managers} />}
      </TableCell>
      <TableCell className={classes.buttonsCell}>
        <PortalRowButtons item={item} propertyId={propertyId} />
      </TableCell>
      <TableCell className={classes.menuCell}>
        <PortalRowMenu
          item={item}
          propertyId={propertyId}
          archiveMutation={archiveMutation}
          restoreMutation={restoreMutation}
          disableMutation={disableMutation}
          extra={menuExtra}
        />
      </TableCell>
    </TableRow>
  )
}
