// A Portal's actions in the overview: Edit and Share as buttons, and everything
// else behind "more actions". Share is not offered where there is nothing to
// share: a draft has no code to give out, and an archived Portal is finished.
// Its place stays, unseen, in a table row, so Edit sits in one column in every row.
import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Ellipsis, Pencil, QrCode } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { Button, buttonVariants } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { useOverviewClasses } from './portal-overview-density'
import { PortalArchiveDialog, type PortalArchiveMutations } from './portal-archive-dialog'
import { PortalDisableDialog } from './portal-disable-dialog'
import type { PortalOverviewItem } from './portal-overview-view'
import {
  portalRowMenu,
  type PortalRowMenuItem,
  type PortalRowMenuItemId,
} from './portal-row-menu'
import { IconButton } from '#/components/ui/icon-button'

type RowProps = Readonly<{ item: PortalOverviewItem; propertyId: string }>

export function PortalRowButtons({ item, propertyId }: RowProps) {
  const classes = useOverviewClasses()
  const { can } = usePermissions()
  const { row } = item
  const params = { propertyId, portalId: row.portalId }
  const verb = can('portal.update') ? 'Edit' : 'View'
  const canShare = row.publicationState !== 'draft' && row.publicationState !== 'archived'
  return (
    <>
      <Button variant="outline" size="sm" asChild>
        <Link
          to="/properties/$propertyId/portals/$portalId"
          params={params}
          search={{ tab: 'page' }}
          aria-label={`${verb} ${row.name}`}
        >
          <Pencil aria-hidden="true" className={classes.cardOnly} />
          {verb}
        </Link>
      </Button>
      {canShare ? (
        <Button variant="outline" size="sm" asChild>
          <Link
            to="/properties/$propertyId/portals/$portalId"
            params={params}
            search={{ tab: 'share' }}
            aria-label={`Share ${row.name}`}
          >
            <QrCode aria-hidden="true" />
            <span className={classes.shareLabel}>Share</span>
          </Link>
        </Button>
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'invisible',
            classes.sharePlaceholder,
          )}
        >
          <QrCode />
          <span className={classes.shareLabel}>Share</span>
        </span>
      )}
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
    <DropdownMenuItem asChild>
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
  disableMutation,
  extra,
}: RowProps &
  PortalArchiveMutations &
  Readonly<{
    /** Entries a page adds of its own, between the links and the archive entry. */
    extra?: ReactNode
  }>) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const [confirming, setConfirming] = useState<LifecycleId | null>(null)
  const { row } = item
  const menu = portalRowMenu(row, {
    canUpdate: can('portal.update'),
    canArchive: can('portal.delete'),
    portalWriteEnabled: has('portal.write'),
  }).filter((entry) => entry.id !== 'disable' || disableMutation !== undefined)
  const links = menu.filter((entry) => !isLifecycle(entry.id))
  const lifecycle = menu.filter((entry) => isLifecycle(entry.id))
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            variant="ghost"
            size="icon-sm"
            tooltip={false}
            className="text-muted-foreground"
            label={`More actions for ${row.name}`}
          >
            <Ellipsis aria-hidden="true" />
          </IconButton>
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
              onSelect={() => setConfirming(lifecycleId(entry.id))}
            >
              {entry.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {lifecycle.some((entry) => entry.id !== 'disable') ? (
        <PortalArchiveDialog
          portalId={row.portalId}
          portalName={row.name}
          restoring={row.publicationState === 'archived'}
          open={confirming === 'archive' || confirming === 'restore'}
          onOpenChange={(open) => setConfirming(open ? confirming : null)}
          archiveMutation={archiveMutation}
          restoreMutation={restoreMutation}
        />
      ) : null}
      {disableMutation !== undefined &&
      lifecycle.some((entry) => entry.id === 'disable') ? (
        <PortalDisableDialog
          portalId={row.portalId}
          portalName={row.name}
          open={confirming === 'disable'}
          onOpenChange={(open) => setConfirming(open ? 'disable' : null)}
          disableMutation={disableMutation}
        />
      ) : null}
    </>
  )
}

/** The menu entries that open a confirmation rather than a page. */
type LifecycleId = Extract<PortalRowMenuItemId, 'disable' | 'archive' | 'restore'>

function isLifecycle(id: PortalRowMenuItemId): id is LifecycleId {
  return id === 'disable' || id === 'archive' || id === 'restore'
}

function lifecycleId(id: PortalRowMenuItemId): LifecycleId | null {
  return isLifecycle(id) ? id : null
}
