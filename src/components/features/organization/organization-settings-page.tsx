import { useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { Badge } from '#/components/ui/badge'
import { ImageUploadField } from '#/components/forms/image-upload-field'
import { OrganizationSettingsForm } from './organization-settings-form'
import { OrganizationSwitchList } from './organization-switch-list'
import {
  updateOrganization,
  requestOrgLogoUpload,
  finalizeOrgLogoUpload,
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
}>

export function OrganizationSettingsPage({
  organization,
  organizations,
  activeOrganizationId,
}: Props) {
  const [logoUrl, setLogoUrl] = useState(organization.logo)
  const updateOrg = useAction(useServerFn(updateOrganization))
  const requestUpload = useServerFn(requestOrgLogoUpload)
  const finalizeUpload = useServerFn(finalizeOrgLogoUpload)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <ImageUploadField
          imageUrl={logoUrl}
          onImageUrlChange={(url) => {
            setLogoUrl(url)
            if (url !== organization.logo) {
              updateOrg({ data: { logo: url } }).catch(() => {})
            }
          }}
          onUpload={async (file) => {
            const { uploadUrl, key } = await requestUpload({
              data: { contentType: file.type, fileSize: file.size },
            })
            await fetch(uploadUrl, {
              method: 'PUT',
              body: file,
              headers: { 'Content-Type': file.type },
            })
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

      <OrganizationSwitchList
        organizations={organizations}
        activeOrganizationId={activeOrganizationId}
      />
    </div>
  )
}
