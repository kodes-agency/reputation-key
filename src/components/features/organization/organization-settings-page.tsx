import { useServerFn } from '@tanstack/react-start'
import type { Action } from '#/components/hooks/use-action'
import { ImageSetting } from '#/components/forms/image-setting'
import { putFilePresigned } from '#/components/forms/image-setting/put-file-presigned'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
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
  /**
   * Removing the logo is an immediate action, not part of the identity form's
   * submit, so it has its own mutation. The logo setting says its failure (a
   * toast), and never the form's banner.
   */
  removeOrganizationLogo: Action<
    Parameters<typeof updateOrganization>[0],
    Awaited<ReturnType<typeof updateOrganization>>
  >
  requestOrgLogoUploadFn: typeof requestOrgLogoUpload
  /** Confirms the upload and saves the logo's address. */
  finalizeOrgLogo: Action<
    Parameters<typeof finalizeOrgLogoUpload>[0],
    Awaited<ReturnType<typeof finalizeOrgLogoUpload>>
  >
}>

type LogoCardProps = Readonly<
  Pick<Props, 'removeOrganizationLogo' | 'requestOrgLogoUploadFn' | 'finalizeOrgLogo'> & {
    logo: string | null
  }
>

/**
 * The logo is an image setting, framed like the avatar: a card named for it, and
 * Upload, Replace and Remove in words. Both are immediate, so the setting says a
 * refusal and the mutations behind it only say what succeeded.
 */
function OrganizationLogoCard({
  logo,
  removeOrganizationLogo,
  requestOrgLogoUploadFn,
  finalizeOrgLogo,
}: LogoCardProps) {
  const requestUpload = useServerFn(requestOrgLogoUploadFn)

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Logo</CardTitle>
        <CardDescription>The picture that stands for your organization.</CardDescription>
      </CardHeader>
      <CardContent>
        <ImageSetting
          subject="logo"
          imageUrl={logo}
          onUpload={async (file, onProgress) => {
            const { uploadUrl, key } = await requestUpload({
              data: { contentType: file.type, fileSize: file.size },
            })
            await putFilePresigned(uploadUrl, file, onProgress)
            const { logoUrl } = await finalizeOrgLogo({ data: { key } })
            return logoUrl
          }}
          onRemove={() => removeOrganizationLogo({ data: { logo: null } })}
        />
      </CardContent>
    </Card>
  )
}

export function OrganizationSettingsPage({
  organization,
  responseTargetSettings,
  privateFeedbackTargetAnalytics,
  googleReviewTargetAnalytics,
  updateResponseTargetPolicy,
  updateOrganization,
  removeOrganizationLogo,
  requestOrgLogoUploadFn,
  finalizeOrgLogo,
}: Props) {
  return (
    <div className="space-y-6">
      <OrganizationLogoCard
        logo={organization.logo}
        removeOrganizationLogo={removeOrganizationLogo}
        requestOrgLogoUploadFn={requestOrgLogoUploadFn}
        finalizeOrgLogo={finalizeOrgLogo}
      />

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
