// The workspace's read-only line: when nothing in this portal can be changed it
// says why, under the tabs, for every tab, and an archived portal offers
// Restore right there (the Portals list's own confirmation and write), so the
// way out is not only in the list's row menu.
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { updatePortal } from '#/contexts/portal/server/portals'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { Button } from '#/components/ui/button'
import { canRestorePortal } from '#/components/features/portal/portal-detail/portal-edit-access'
import { usePortalEditAccess } from '#/components/features/portal/portal-detail/use-portal-edit-access'
import { PortalArchiveDialog } from '#/components/features/portal/portal-overview/portal-archive-dialog'
import { PortalReadOnlyNotice } from '#/components/features/portal/portal-workspace/portal-read-only-notice'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { portalKeys } from '#/shared/queries/query-keys'
import { portalQuery } from './-portal-detail-data'

type Props = Readonly<{ propertyId: string; portalId: string }>

export function PortalWorkspaceNoticeSlot({ propertyId, portalId }: Props) {
  const { data } = useSuspenseQuery(portalQuery(portalId))
  const portal = data.portal
  const { readOnlyReason } = usePortalEditAccess(portal?.publicationState ?? 'draft')
  if (!portal || readOnlyReason === null) return null
  return readOnlyReason === 'archived' ? (
    <ArchivedNotice
      propertyId={propertyId}
      portalId={portalId}
      portalName={portal.name}
    />
  ) : (
    <PortalReadOnlyNotice reason={readOnlyReason} />
  )
}

function ArchivedNotice({
  propertyId,
  portalId,
  portalName,
}: Props & Readonly<{ portalName: string }>) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const [confirming, setConfirming] = useState(false)
  // The dialog shows a refusal itself, so this write toasts only its success.
  // Everything about portals follows: this one's detail and history, and the
  // lists that show it.
  const restoreMutation = useActionMutation(updatePortal, {
    successMessage: 'Portal restored as disabled',
    invalidateKeys: [portalKeys.list(propertyId), portalKeys.all],
  })
  const mayRestore = canRestorePortal({
    canUpdate: can('portal.update'),
    portalWriteEnabled: has('portal.write'),
  })
  if (!mayRestore) return <PortalReadOnlyNotice reason="archived" />
  return (
    <>
      <PortalReadOnlyNotice
        reason="archived"
        action={
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            Restore
          </Button>
        }
      />
      <PortalArchiveDialog
        portalId={portalId}
        portalName={portalName}
        restoring
        open={confirming}
        onOpenChange={setConfirming}
        // Restoring only: the archive half is never offered from here.
        archiveMutation={restoreMutation}
        restoreMutation={restoreMutation}
      />
    </>
  )
}
