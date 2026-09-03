import { useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import type { Action } from '#/components/hooks/use-action'
import { toast } from 'sonner'
import { Badge } from '#/components/ui/badge'
import { ImageUploadField } from '#/components/forms/image-upload-field'
import { putFilePresigned } from '#/components/forms/image-upload-field/put-file-presigned'
import { OrganizationSettingsForm } from './organization-settings-form'
import { ResponseTargetSettingsCard } from './response-target-settings-card'
import type {
  GoogleReviewTargetAnalytics,
  PrivateFeedbackTargetAnalytics,
  ResponseTargetPolicySettings,
} from '#/contexts/inbox/application/public-api'
import type { setResponseTargetPolicyFn } from '#/contexts/inbox/server/inbox'
import type {
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
}>
type Props = Readonly<{
  organization: OrgData
  responseTargetSettings: ResponseTargetPolicySettings
  privateFeedbackTargetAnalytics: PrivateFeedbackTargetAnalytics
  googleReviewTargetAnalytics: GoogleReviewTargetAnalytics
  updateResponseTargetPolicy: Action<
    Parameters<typeof setResponseTargetPolicyFn>[0],
    Awaited<ReturnType<typeof setResponseTargetPolicyFn>>
  >
  updateOrganization: Action<
    Parameters<typeof updateOrganization>[0],
    Awaited<ReturnType<typeof updateOrganization>>
  >
  requestOrgLogoUploadFn: typeof requestOrgLogoUpload
  finalizeOrgLogoUploadFn: typeof finalizeOrgLogoUpload
}>

type LogoEditorProps = Readonly<
  Pick<
    Props,
    'updateOrganization' | 'requestOrgLogoUploadFn' | 'finalizeOrgLogoUploadFn'
  > & { logo: string | null }
>

function OrganizationLogoEditor({
  logo,
  updateOrganization,
  requestOrgLogoUploadFn,
  finalizeOrgLogoUploadFn,
}: LogoEditorProps) {
  const [logoUrl, setLogoUrl] = useState(logo)
  const requestUpload = useServerFn(requestOrgLogoUploadFn)
  const finalizeUpload = useServerFn(finalizeOrgLogoUploadFn)

  return (
    <ImageUploadField
      imageUrl={logoUrl}
      onImageUrlChange={(url) => {
        setLogoUrl(url)
        // Only persist on remove (null) — upload persistence is handled by finalizeOrgLogoUpload
        if (url === null) {
          updateOrganization({ data: { logo: null } }).catch(() => {
            toast.error('Failed to remove logo')
            setLogoUrl(logo)
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
      disabled={updateOrganization.isPending}
    />
  )
}

export function OrganizationSettingsPage({
  organization,
  responseTargetSettings,
  privateFeedbackTargetAnalytics,
  googleReviewTargetAnalytics,
  updateResponseTargetPolicy,
  updateOrganization,
  requestOrgLogoUploadFn,
  finalizeOrgLogoUploadFn,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <OrganizationLogoEditor
          key={organization.logo ?? 'no-logo'}
          logo={organization.logo}
          updateOrganization={updateOrganization}
          requestOrgLogoUploadFn={requestOrgLogoUploadFn}
          finalizeOrgLogoUploadFn={finalizeOrgLogoUploadFn}
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
        key={`${organization.name}:${organization.slug}:${organization.contactEmail ?? 'no-contact-email'}`}
        organization={organization}
        onSubmit={async (values) => {
          await updateOrganization({ data: values })
        }}
        isPending={updateOrganization.isPending}
        error={updateOrganization.error}
      />
      <ResponseTargetSettingsCard
        settings={responseTargetSettings}
        privateFeedbackAnalytics={privateFeedbackTargetAnalytics}
        googleReviewAnalytics={googleReviewTargetAnalytics}
        updatePolicy={updateResponseTargetPolicy}
      />
    </div>
  )
}
