// A Portal's actions in the overview: Edit and Share as buttons, and everything
// else behind "more actions". Share is not offered where there is nothing to
// share: a draft has no code to give out, and an archived Portal is finished.
// Its place stays, unseen, in a table row, so Edit sits in one column in every row.
import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Pencil, QrCode } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { Button, buttonVariants } from '#/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'
import {
  RowActionsItem,
  RowActionsMenu,
  RowActionsSeparator,
} from '#/components/ui/row-actions-menu'
import { useOverviewClasses } from './portal-overview-density'
import { PortalArchiveDialog, type PortalArchiveMutations } from './portal-archive-dialog'
import { PortalDisableDialog } from './portal-disable-dialog'
import { usePortalAccess } from './use-portal-access'
import type { PortalOverviewItem } from './portal-overview-view'
import {
  portalRowMenu,
  type PortalRowMenuItem,
  type PortalRowMenuItemId,
} from './portal-row-menu'

type RowProps = Readonly<{ item: PortalOverviewItem; propertyId: string }>

export function PortalRowButtons({ item, propertyId }: RowProps) {
  const classes = useOverviewClasses()
  const { canEdit } = usePortalAccess()
  const { row } = item
  const params = { propertyId, portalId: row.portalId }
  // The role may update portals only while the organisation's portal writes are on.
  const verb = canEdit ? 'Edit' : 'View'
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
        <ShareButton
          item={item}
          propertyId={propertyId}
          // A density that hides Share's words from its table width on leaves the glyph alone.
          iconOnly={classes.shareLabel !== ''}
          labelClass={classes.shareLabel}
        />
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

const SHARE_HINT = 'Share: QR code, link and print kit'

/** Share, as a button; where the table leaves it only its glyph, the glyph says what it is. */
function ShareButton({
  item,
  propertyId,
  iconOnly,
  labelClass,
}: RowProps & Readonly<{ iconOnly: boolean; labelClass: string }>) {
  const { row } = item
  const button = (
    <Button variant="outline" size="sm" asChild>
      <Link
        to="/properties/$propertyId/portals/$portalId"
        params={{ propertyId, portalId: row.portalId }}
        search={{ tab: 'share' }}
        aria-label={`Share ${row.name}`}
      >
        <QrCode aria-hidden="true" />
        <span className={labelClass}>Share</span>
      </Link>
    </Button>
  )
  if (!iconOnly) return button
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{SHARE_HINT}</TooltipContent>
    </Tooltip>
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
    <RowActionsItem asChild>
      <Link to={to} params={params} search={search}>
        {menuItem.label}
      </Link>
    </RowActionsItem>
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
      <RowActionsMenu name={row.name}>
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
          <RowActionsSeparator />
        ) : null}
        {lifecycle.map((entry) => (
          <RowActionsItem
            key={entry.id}
            opensDialog
            onSelect={() => setConfirming(lifecycleId(entry.id))}
          >
            {entry.label}
          </RowActionsItem>
        ))}
      </RowActionsMenu>
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
