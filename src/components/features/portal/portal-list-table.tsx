// Portal table rows — extracted from portal-list-page so that page can carry the
// search + pagination controls without breaking the 200-line component limit.
// The row itself lives in portal-list-row so this stays a flat table shell.
import { Table, TableBody, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { PortalListRow } from './portal-list-row'
import type { Action } from '#/components/hooks/use-action'
import type { PortalListItem } from './portal-list-types'

type Props = Readonly<{
  portals: readonly PortalListItem[]
  propertyId: string
  canDelete: boolean
  canUpdate: boolean
  archiveMutation: Action<{
    data: { portalId: string; publicationState: 'archived' }
  }>
  restoreMutation: Action<{
    data: { portalId: string; publicationState: 'disabled' }
  }>
}>

export function PortalListTable({
  portals,
  propertyId,
  canDelete,
  canUpdate,
  archiveMutation,
  restoreMutation,
}: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Theme</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {portals.map((portal) => (
          <PortalListRow
            key={portal.id}
            portal={portal}
            propertyId={propertyId}
            canDelete={canDelete}
            canUpdate={canUpdate}
            archiveMutation={archiveMutation}
            restoreMutation={restoreMutation}
          />
        ))}
      </TableBody>
    </Table>
  )
}
