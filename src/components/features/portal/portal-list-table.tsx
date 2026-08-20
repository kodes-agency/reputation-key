// Portal table rows — extracted from portal-list-page so that page can carry the
// search + pagination controls without breaking the 200-line component limit.
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Eye } from 'lucide-react'
import { PortalArchiveButton } from './portal-archive-button'
import type { Action } from '#/components/hooks/use-action'
import type { PortalListItem } from './portal-list-types'

// A Record, not a formatting expression: adding a state to the domain union now
// fails to compile here instead of rendering the raw identifier. The previous
// `state[0].toUpperCase() + state.slice(1)` accepted anything.
const PUBLICATION_LABELS: Record<PortalListItem['publicationState'], string> = {
  draft: 'Draft',
  published: 'Published',
  disabled: 'Disabled',
  archived: 'Archived',
}

type Props = Readonly<{
  portals: readonly PortalListItem[]
  propertyId: string
  canDelete: boolean
  deleteMutation: Action<{ data: { portalId: string } }>
}>

export function PortalListTable({
  portals,
  propertyId,
  canDelete,
  deleteMutation,
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
        {portals.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <Link
                to="/properties/$propertyId/portals/$portalId"
                params={{ propertyId, portalId: p.id }}
                search={{ tab: 'settings' }}
                className="font-medium hover:underline"
              >
                {p.name}
              </Link>
            </TableCell>
            <TableCell>
              <div
                className="size-5 rounded-full border"
                style={{ backgroundColor: p.theme.primaryColor }}
              />
            </TableCell>
            <TableCell>
              <Badge variant={p.publicationState === 'published' ? 'default' : 'outline'}>
                {PUBLICATION_LABELS[p.publicationState]}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1">
                <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" asChild>
                  <Link
                    to="/properties/$propertyId/portals/$portalId"
                    params={{ propertyId, portalId: p.id }}
                    aria-label={`View ${p.name}`}
                    search={{ tab: 'settings' }}
                  >
                    <Eye className="size-3.5" />
                  </Link>
                </Button>
                {canDelete && (
                  <PortalArchiveButton
                    portalId={p.id}
                    portalName={p.name}
                    deleteMutation={deleteMutation}
                  />
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
