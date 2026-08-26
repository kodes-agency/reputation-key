// Portal settings — publication, identity, image, theme, and content review.
// Mutation state is owned by the route and reflected through the query-backed portal prop.
// The publication decisions live in portal-settings-rules.ts, so this file is a
// flat list of the blocks on screen plus the one permission fact they share.

import { EditPortalForm } from '../portal-form/edit-portal-form'
import { ThemePresetSelector } from './theme-preset-selector'
import { ContentReviewCard } from './content-review-card'
import { PortalPublicationRow } from './portal-publication-row'
import { PortalPublicationHistoryCard } from './portal-publication-history-card'
import { saveStatusMessage } from './portal-settings-rules'
import { ResponsibleManagersCard } from './responsible-managers-card'
import { Button } from '#/components/ui/button'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { Action } from '#/components/hooks/use-action'
import type {
  CompleteReviewResult,
  CompleteReviewVariables,
  FormLike,
  PortalData,
  PortalThemeDraft,
  UpdatePortalVariables,
} from '../shared/types'
import type {
  PortalResponsibleManagerState,
  ResponsibleManagerMember,
} from '../portal-detail/portal-detail-types'
import { GoogleReviewDestinationCard } from './google-review-destination-card'
import type { GoogleReviewDestinationStatus } from './google-review-destination-status'
import type { PortalPublicationHistory } from '#/contexts/portal/application/public-api'

type Props = Readonly<{
  portal: PortalData
  googleReviewDestination: GoogleReviewDestinationStatus
  publicationHistory: PortalPublicationHistory
  mutation: Action<UpdatePortalVariables>
  completeReviewMutation: Action<CompleteReviewVariables, CompleteReviewResult>
  theme: PortalThemeDraft
  onThemeChange: (theme: PortalThemeDraft) => void
  requestUploadUrl: (input: {
    data: { portalId: string; contentType: string; fileSize: number }
  }) => Promise<{
    uploadUrl: string
    uploadId: string
    requiredHeaders: Readonly<Record<string, string>>
  }>
  finalizeUpload: (input: { data: { portalId: string; uploadId: string } }) => Promise<{
    heroImageUrl: string | null
    processing: boolean
  }>
  formRef: React.RefObject<FormLike | null>
  responsibleManagers?: PortalResponsibleManagerState
  responsibleManagerMembers?: readonly ResponsibleManagerMember[]
  updateResponsibleManagersMutation?: Action<{
    data: {
      portalId: string
      managerUserIds: string[]
      expectedRevision: number
    }
  }>
}>

export function PortalSettings({
  portal,
  googleReviewDestination,
  publicationHistory,
  mutation,
  completeReviewMutation,
  theme,
  onThemeChange,
  requestUploadUrl,
  finalizeUpload,
  formRef,
  responsibleManagers,
  responsibleManagerMembers,
  updateResponsibleManagersMutation,
}: Props) {
  const { can } = usePermissions()
  const canManage = can('portal.update')
  const isArchived = portal.publicationState === 'archived'
  // An archived portal is read-only even for a `portal.update` holder: its
  // configuration and history are retained exactly as they were.
  const canEdit = canManage && !isArchived

  return (
    <section
      className="space-y-6 rounded-lg border p-4 sm:p-6"
      aria-labelledby="portal-settings-heading"
    >
      <div className="space-y-1">
        <h2 id="portal-settings-heading" className="text-lg font-semibold">
          Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Update the public page and control whether guests can open it.
        </p>
      </div>

      <PortalPublicationRow portal={portal} mutation={mutation} canManage={canManage} />

      <PortalPublicationHistoryCard history={publicationHistory} />

      <GoogleReviewDestinationCard destination={googleReviewDestination} />

      {responsibleManagers &&
        responsibleManagerMembers &&
        updateResponsibleManagersMutation && (
          <ResponsibleManagersCard
            portalId={portal.id}
            state={responsibleManagers}
            members={responsibleManagerMembers}
            updateAction={updateResponsibleManagersMutation}
            disabled={!canEdit}
          />
        )}

      <EditPortalForm
        portal={portal}
        mutation={mutation}
        disabled={isArchived}
        theme={theme}
        formRef={formRef}
        requestUploadUrl={requestUploadUrl}
        finalizeUpload={finalizeUpload}
      />

      <div className="space-y-2">
        <h3 className="font-semibold">Theme</h3>
        <p className="text-sm text-muted-foreground">
          Choose the palette used on the public page, then save your changes.
        </p>
        <ThemePresetSelector
          theme={theme}
          onThemeChange={onThemeChange}
          disabled={!canEdit || mutation.isPending}
        />
      </div>

      <SaveChangesButton
        show={canEdit}
        isPending={mutation.isPending}
        formRef={formRef}
      />
      <p className="sr-only" role="status" aria-live="polite">
        {saveStatusMessage(mutation.isPending, mutation.isSuccess)}
      </p>

      <ContentReviewCard
        portal={portal}
        mutation={completeReviewMutation}
        disabled={!canEdit}
      />
    </section>
  )
}

function SaveChangesButton({
  show,
  isPending,
  formRef,
}: Readonly<{
  show: boolean
  isPending: boolean
  formRef: React.RefObject<FormLike | null>
}>) {
  if (!show) return null
  return (
    <Button onClick={() => formRef.current?.handleSubmit()} disabled={isPending}>
      {isPending ? 'Saving…' : 'Save changes'}
    </Button>
  )
}
