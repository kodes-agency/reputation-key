// A Portal's actions in the overview: Edit and Share as buttons, and everything
// else behind "more actions". Share is not offered where there is nothing to
// share: a draft has no code to give out, and an archived Portal is finished.
import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Ellipsis, Pencil, QrCode } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { PortalArchiveDialog, type PortalArchiveMutations } from './portal-archive-dialog'
import type { PortalOverviewItem } from './portal-overview-view'
import { portalRowMenu, type PortalRowMenuItem } from './portal-row-menu'

// The global `a` colour is unlayered, so a link used as a menu item pins its ink.
const ITEM = 'min-h-11 text-foreground! md:min-h-8'
const BUTTON = 'min-h-11 md:min-h-8'

type RowProps = Readonly<{ item: PortalOverviewItem; propertyId: string }>

export function PortalRowButtons({ item, propertyId }: RowProps) {
  const { can } = usePermissions()
  const { row } = item
  const params = { propertyId, portalId: row.portalId }
  const verb = can('portal.update') ? 'Edit' : 'View'
  const canShare = row.publicationState !== 'draft' && row.publicationState !== 'archived'
  return (
    <>
      <Button variant="outline" size="sm" asChild className={BUTTON}>
        <Link
          to="/properties/$propertyId/portals/$portalId"
          params={params}
          search={{ tab: 'page' }}
          aria-label={`${verb} ${row.name}`}
        >
          <Pencil aria-hidden="true" className="@4xl:hidden" />
          {verb}
        </Link>
      </Button>
      {canShare ? (
        <Button variant="outline" size="sm" asChild className={BUTTON}>
          <Link
            to="/properties/$propertyId/portals/$portalId"
            params={params}
            search={{ tab: 'share' }}
            aria-label={`Share ${row.name}`}
          >
            <QrCode aria-hidden="true" />
            Share
          </Link>
        </Button>
      ) : null}
    </>
  )
}

function MenuLink({
  menuItem,
  propertyId,
  portalId,
}: Readonly<{ menuItem: PortalRowMenuItem; propertyId: string; portalId: string }>) {
  const params = { propertyId, portalId }
  const to =
    menuItem.id === 'review'
      ? '/properties/$propertyId/portals/$portalId/review'
      : '/properties/$propertyId/portals/$portalId'
  const search = {
    tab:
      menuItem.id === 'history'
        ? 'history'
        : menuItem.id === 'results'
          ? 'results'
          : 'page',
  } as const
  return (
    <DropdownMenuItem asChild className={ITEM}>
      <Link to={to} params={params} search={search}>
        {menuItem.label}
      </Link>
    </DropdownMenuItem>
  )
}

export function PortalRowMenu({
  item,
  propertyId,
  archiveMutation,
  restoreMutation,
  extra,
}: RowProps &
  PortalArchiveMutations &
  Readonly<{
    /** Entries a page adds of its own, between the links and the archive entry. */
    extra?: ReactNode
  }>) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const [confirming, setConfirming] = useState(false)
  const { row } = item
  const menu = portalRowMenu(row, {
    canUpdate: can('portal.update'),
    canArchive: can('portal.delete'),
    portalWriteEnabled: has('portal.write'),
  })
  const links = menu.filter((entry) => entry.id !== 'archive' && entry.id !== 'restore')
  const lifecycle = menu.filter(
    (entry) => entry.id === 'archive' || entry.id === 'restore',
  )
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-muted-foreground md:size-8"
            aria-label={`More actions for ${row.name}`}
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {links.map((entry) => (
            <MenuLink
              key={entry.id}
              menuItem={entry}
              propertyId={propertyId}
              portalId={row.portalId}
            />
          ))}
          {extra}
          {links.length + (extra ? 1 : 0) > 0 && lifecycle.length > 0 ? (
            <DropdownMenuSeparator />
          ) : null}
          {lifecycle.map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              variant={entry.destructive ? 'destructive' : 'default'}
              className={
                entry.destructive ? 'min-h-11 text-destructive! md:min-h-8' : ITEM
              }
              onSelect={() => setConfirming(true)}
            >
              {entry.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {lifecycle.length > 0 ? (
        <PortalArchiveDialog
          portalId={row.portalId}
          portalName={row.name}
          restoring={row.publicationState === 'archived'}
          open={confirming}
          onOpenChange={setConfirming}
          archiveMutation={archiveMutation}
          restoreMutation={restoreMutation}
        />
      ) : null}
    </>
  )
}
