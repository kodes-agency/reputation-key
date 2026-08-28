// One portal row, extracted from portal-list-table so the table body is a flat
// map over a named component instead of six levels of nested JSX.
import { Link } from '@tanstack/react-router'
import { Eye } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { TableCell, TableRow } from '#/components/ui/table'
import { PortalArchiveButton } from './portal-archive-button'
import type { Action } from '#/components/hooks/use-action'
import type { PortalListItem } from './portal-list-types'
import {
  PUBLICATION_BADGE_VARIANTS,
  PUBLICATION_LABELS,
} from './portal-publication-badge'

type RowProps = Readonly<{
  portal: PortalListItem
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

export function PortalListRow({
  portal,
  propertyId,
  canDelete,
  canUpdate,
  archiveMutation,
  restoreMutation,
}: RowProps) {
  return (
    <TableRow>
      <TableCell>
        <Link
          to="/properties/$propertyId/portals/$portalId"
          params={{ propertyId, portalId: portal.id }}
          search={{ tab: 'settings' }}
          className="font-medium hover:underline"
        >
          {portal.name}
        </Link>
      </TableCell>
      <TableCell>
        <div
          className="size-5 rounded-full border"
          style={{ backgroundColor: portal.theme.primaryColor }}
        />
      </TableCell>
      <TableCell>
        <Badge variant={PUBLICATION_BADGE_VARIANTS[portal.publicationState]}>
          {PUBLICATION_LABELS[portal.publicationState]}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <PortalRowActions
          portal={portal}
          propertyId={propertyId}
          canDelete={canDelete}
          canUpdate={canUpdate}
          archiveMutation={archiveMutation}
          restoreMutation={restoreMutation}
        />
      </TableCell>
    </TableRow>
  )
}

function PortalRowActions({
  portal,
  propertyId,
  canDelete,
  canUpdate,
  archiveMutation,
  restoreMutation,
}: RowProps) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" asChild>
        <Link
          to="/properties/$propertyId/portals/$portalId"
          params={{ propertyId, portalId: portal.id }}
          aria-label={`View ${portal.name}`}
          search={{ tab: 'settings' }}
        >
          <Eye className="size-3.5" />
        </Link>
      </Button>
      {((portal.publicationState === 'archived' && canUpdate) ||
        (portal.publicationState !== 'archived' && canDelete)) && (
        <PortalArchiveButton
          portalId={portal.id}
          portalName={portal.name}
          publicationState={portal.publicationState}
          archiveMutation={archiveMutation}
          restoreMutation={restoreMutation}
        />
      )}
    </div>
  )
}
