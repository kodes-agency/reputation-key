// Recoverable Portal archive/restore confirmation. Archive preserves the
// Portal's address, snapshots, metrics, assignments, and saved settings. Restore
// is intentionally non-public: it always returns to Disabled and requires a
// later, deliberate publication after the manager re-checks the retained
// configuration.
//
// Controlled: the row's "more actions" menu opens it, because a dialog mounted
// inside a menu item closes with the menu.
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import type { Action } from '#/components/hooks/use-action'
import type { PortalDisableMutation } from './portal-disable-dialog'

/**
 * The Portal lifecycle actions a list offers in a row's "more actions" menu.
 * A list without `disableMutation` leaves "Disable public page" out.
 */
export type PortalArchiveMutations = Readonly<{
  archiveMutation: Action<{
    data: { portalId: string; publicationState: 'archived' }
  }>
  restoreMutation: Action<{
    data: { portalId: string; publicationState: 'disabled' }
  }>
  disableMutation?: PortalDisableMutation
}>

type Props = PortalArchiveMutations &
  Readonly<{
    portalId: string
    portalName: string
    /** Archived Portals are restored; every other state is archived. */
    restoring: boolean
    open: boolean
    onOpenChange: (open: boolean) => void
  }>

export function PortalArchiveDialog({
  portalId,
  portalName,
  restoring,
  open,
  onOpenChange,
  archiveMutation,
  restoreMutation,
}: Props) {
  // Archiving keeps everything and is undone by Restore, which only returns the
  // Portal as Disabled: both confirm in the neutral tone.
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={restoring ? `Restore ${portalName}?` : `Archive ${portalName}?`}
      description={
        restoring
          ? 'The Portal will return as Disabled. Its saved settings remain available, but guests will not see it until you review and publish it again.'
          : 'The Portal will become read-only and unavailable to guests. Its public address, saved settings, publication history, metrics, goals, and manager assignments are retained so it can be restored later.'
      }
      cancelLabel="Cancel"
      confirmLabel={restoring ? 'Restore as disabled' : 'Archive portal'}
      pendingLabel={restoring ? 'Restoring…' : 'Archiving…'}
      onConfirm={() =>
        restoring
          ? restoreMutation({ data: { portalId, publicationState: 'disabled' } })
          : archiveMutation({ data: { portalId, publicationState: 'archived' } })
      }
    />
  )
}
