import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useAction, type Action } from '#/components/hooks/use-action'
import { toast } from 'sonner'
import { Badge } from '#/components/ui/badge'
import { ImageUploadField } from '#/components/forms/image-upload-field'
import { putFilePresigned } from '#/components/forms/image-upload-field/put-file-presigned'
import { OrganizationSettingsForm } from './organization-settings-form'
import { OrganizationSwitchList } from './organization-switch-list'
import { ResponseSlaCard } from './response-sla-card'
import type {
  updateOrganization,
  requestOrgLogoUpload,
  finalizeOrgLogoUpload,
  setActiveOrganization,
} from '#/contexts/identity/server/organizations'

type OrgData = Readonly<{
  id: string
  name: string
  slug: string
  logo: string | null
  contactEmail: string | null
  billingCompanyName: string | null
  billingAddress: string | null
  billingCity: string | null
  billingPostalCode: string | null
  billingCountry: string | null
}>
type Props = Readonly<{
  organization: OrgData
  organizations: ReadonlyArray<{ id: string; name: string }>
  activeOrganizationId: string | null
  responseSlaHours: number
  updateResponseSla: Action<
    Readonly<{ data: Readonly<{ responseSlaHours: number }> }>,
    { responseSlaHours: number }
  >
  updateOrganizationFn: typeof updateOrganization
  requestOrgLogoUploadFn: typeof requestOrgLogoUpload
  finalizeOrgLogoUploadFn: typeof finalizeOrgLogoUpload
  setActiveOrganizationFn: typeof setActiveOrganization
}>

export function OrganizationSettingsPage({
  organization,
  organizations,
  activeOrganizationId,
  responseSlaHours,
  updateResponseSla,
  updateOrganizationFn,
  requestOrgLogoUploadFn,
  finalizeOrgLogoUploadFn,
  setActiveOrganizationFn,
}: Props) {
  const [logoUrl, setLogoUrl] = useState(organization.logo)
  const navigate = useNavigate()
  const updateOrg = useAction(useServerFn(updateOrganizationFn))
  const requestUpload = useServerFn(requestOrgLogoUploadFn)
  const finalizeUpload = useServerFn(finalizeOrgLogoUploadFn)
  const switchOrg = useAction(useServerFn(setActiveOrganizationFn))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <ImageUploadField
          imageUrl={logoUrl}
          onImageUrlChange={(url) => {
            setLogoUrl(url)
            // Only persist on remove (null) — upload persistence is handled by finalizeOrgLogoUpload
            if (url === null) {
              updateOrg({ data: { logo: null } }).catch(() => {
                toast.error('Failed to remove logo')
                setLogoUrl(organization.logo)
              })
            }
          }}
          onUpload={async (file, onProgress) => {
            const { uploadUrl, key } = await requestUpload({
              data: { contentType: file.type, fileSize: file.size },
            })
            await putFilePresigned(uploadUrl, file, onProgress)
            const { logoUrl: url } = await finalizeUpload({ data: { key } })
            return url
          }}
          variant="circle"
          emptyLabel="Upload logo"
          maxFileSize={5 * 1024 * 1024}
          disabled={updateOrg.isPending}
        />
        <div>
          <h1 className="text-xl font-semibold tracking-tight display-title">
            {organization.name}
          </h1>
          <Badge variant="secondary" className="mt-1">
            {organization.slug}
          </Badge>
        </div>
      </div>

      <OrganizationSettingsForm
        organization={organization}
        onSubmit={async (values) => {
          await updateOrg({ data: values })
        }}
        isPending={updateOrg.isPending}
        error={updateOrg.error}
      />
      <ResponseSlaCard
        responseSlaHours={responseSlaHours}
        updateSla={updateResponseSla}
      />

      <OrganizationSwitchList
        organizations={organizations}
        activeOrganizationId={activeOrganizationId}
        onSwitch={(orgId) =>
          switchOrg({ data: { organizationId: orgId } }).then(() =>
            navigate({ to: '/properties' }),
          )
        }
        isPending={switchOrg.isPending}
      />
    </div>
  )
}
