import { isOfferedGuestLocale } from '#/shared/domain/guest-locale'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useStaffFunctions } from './staff-account-functions'
import { useQuery } from '@tanstack/react-query'
import { portalKeys } from '#/shared/queries/query-keys'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogCancel,
} from '#/components/ui/dialog'
import { StaffAddForm } from './staff-add-form'

export function StaffAddDialog({
  propertyId,
  groupId,
  onClose,
}: Readonly<{ propertyId: string; groupId?: string; onClose: () => void }>) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const canBrowse = can('portal.read') && has('portal.read')
  const {
    listPortals,
    listPortalGroups,
    getPropertyPortalExperience,
    savePropertyPortalBrandContent,
    checkStaffSource,
  } = useStaffFunctions()
  const experience = useQuery({
    enabled: canBrowse,
    queryKey: portalKeys.experience(propertyId, ''),
    queryFn: () => getPropertyPortalExperience({ data: { propertyId } }),
  })
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
        {!(sources && groupOptions && experience.data) ? (
          <DialogHeader>
            <DialogTitle>Add staff</DialogTitle>
          </DialogHeader>
        ) : null}
        <FormErrorBanner error={portals.error ?? groups.error ?? experience.error} />
        {sources && groupOptions && experience.data ? (
          <StaffAddForm
            propertyId={propertyId}
            initialGroupId={groupId}
            portals={sources
              .filter((p) => p.publicationState === 'published' && p.kind !== 'personal')
              .map((p) => ({
                id: p.id,
                name: p.name,
                groupId: groupOptions.find((group) => group.portalIds.includes(p.id))?.id,
              }))}
            groups={groupOptions}
            wording={guestWording(experience.data)}
            saveWording={savePropertyPortalBrandContent}
            checkSource={checkStaffSource}
          />
        ) : canBrowse && !portals.error && !groups.error && !experience.error ? (
          <p role="status">Loading…</p>
        ) : (
          <>
            <p>
              Guest pages are unavailable. Ask an account admin to check access before
              adding staff.
            </p>
            <DialogFooter>
              <DialogCancel>Close</DialogCancel>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function guestWording(
  data: Awaited<
    ReturnType<ReturnType<typeof useStaffFunctions>['getPropertyPortalExperience']>
  >,
) {
  // The language the new Portal will start in: the first default still offered.
  const locale = data.profile?.defaultGuestLocales.find(isOfferedGuestLocale) ?? 'en'
  const content = data.content.find((row) => row.locale === locale)
  return {
    locale,
    required: !content?.title?.trim() || !content.shortDescription?.trim(),
    canWrite: data.canManagePropertyBrand,
    title: content?.title || data.profile?.displayName || '',
    shortDescription:
      content?.shortDescription ||
      (locale === 'en' ? "We'd love to hear about your visit." : ''),
  }
}
