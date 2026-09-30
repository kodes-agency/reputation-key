// One Portal in the overview. One DOM for every width: below a 56 rem container
// a row is a card (name and menu, then Edit and Share); from 56 rem it is a
// table row. The same rule as the Properties list, so a Portal's name renders
// once, which Storybook (no CSS container queries to lean on) and the e2e
// journeys both rely on.
import { TableCell, TableHead, TableRow } from '#/components/ui/table'
import { cn } from '#/lib/utils'
import {
  PortalAttentionLine,
  PortalManagersCell,
  PortalMetaLine,
  PortalNameLink,
} from './portal-overview-cells'
import type { PortalArchiveMutations } from './portal-archive-dialog'
import { PortalRowButtons, PortalRowMenu } from './portal-overview-row-actions'
import type { PortalOverviewItem } from './portal-overview-view'

/** Columns a head row spans: Portal, Responsible, the actions, the menu. */
export const PORTAL_OVERVIEW_COLUMNS = 4

type Props = PortalArchiveMutations &
  Readonly<{
    item: PortalOverviewItem
    propertyId: string
    /** A flat list has no group heads, so the row says which group it is in. */
    showGroup: boolean
  }>

const CARD_ROW =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-3 rounded-lg border bg-card p-4 ' +
  '@4xl:table-row @4xl:rounded-none @4xl:border-0 @4xl:border-b @4xl:bg-transparent @4xl:p-0'

export function PortalOverviewTableRow({
  item,
  propertyId,
  showGroup,
  archiveMutation,
  restoreMutation,
}: Props) {
  const { row } = item
  const archived = row.publicationState === 'archived'
  return (
    <TableRow className={cn(CARD_ROW, archived && 'opacity-70')}>
      <TableHead
        scope="row"
        className="col-start-1 row-start-1 h-auto min-w-0 p-0 text-left font-normal whitespace-normal @4xl:table-cell @4xl:px-4 @4xl:py-3"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <PortalNameLink
              row={{ propertyId, portalId: row.portalId, name: row.name }}
            />
            <PortalAttentionLine item={item} propertyId={propertyId} />
          </div>
          <PortalMetaLine item={item} showGroup={showGroup} />
        </div>
      </TableHead>
      <TableCell className="hidden p-0 @4xl:table-cell @4xl:w-40 @4xl:px-4 @4xl:py-3">
        {archived ? null : <PortalManagersCell managers={item.managers} />}
      </TableCell>
      <TableCell className="col-span-2 row-start-2 grid grid-cols-2 gap-2 p-0 @4xl:table-cell @4xl:w-56 @4xl:px-2 @4xl:py-3 @4xl:text-right [&>*]:justify-center @4xl:[&>*]:ml-2">
        <PortalRowButtons item={item} propertyId={propertyId} />
      </TableCell>
      <TableCell className="col-start-2 row-start-1 -mt-2 -mr-2 self-start p-0 @4xl:mt-0 @4xl:mr-0 @4xl:table-cell @4xl:w-14 @4xl:px-2 @4xl:py-3 @4xl:text-right">
        <PortalRowMenu
          item={item}
          propertyId={propertyId}
          archiveMutation={archiveMutation}
          restoreMutation={restoreMutation}
        />
      </TableCell>
    </TableRow>
  )
}
