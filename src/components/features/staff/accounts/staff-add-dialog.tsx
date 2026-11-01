import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useStaffFunctions } from './staff-account-functions'
import { useQuery } from '@tanstack/react-query'
import { portalKeys } from '#/shared/queries/query-keys'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { StaffAddForm } from './staff-add-form'

export function StaffAddDialog({
  propertyId,
  groupId,
  onClose,
}: Readonly<{ propertyId: string; groupId?: string; onClose: () => void }>) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const canBrowse = can('portal.read') && has('portal.read')
  const { listPortals, listPortalGroups } = useStaffFunctions()
  const portals = useQuery({
    enabled: canBrowse,
    queryKey: portalKeys.list(propertyId),
    queryFn: () => listPortals({ data: { propertyId } }),
  })
  const groups = useQuery({
    enabled: canBrowse,
    queryKey: portalKeys.groups(propertyId),
    queryFn: () => listPortalGroups({ data: { propertyId } }),
  })
  const sources = canBrowse ? portals.data?.portals : []
  const groupOptions = canBrowse ? groups.data?.groups : []
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent size="lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add staff</DialogTitle>
        </DialogHeader>
        <FormErrorBanner error={portals.error ?? groups.error} />
        {sources && groupOptions ? (
          <StaffAddForm
            propertyId={propertyId}
            initialGroupId={groupId}
            portals={sources
              .filter((p) => p.publicationState === 'published')
              .map((p) => ({ id: p.id, name: p.name }))}
            groups={groupOptions}
          />
        ) : (
          <p role="status">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
