// Portal settings — publication, identity, image, and theme.
// Mutation state is owned by the route and reflected through the query-backed portal prop.

import { EditPortalForm } from '../portal-form/edit-portal-form'
import { ThemePresetSelector } from './theme-preset-selector'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { Action } from '#/components/hooks/use-action'
import type { FormLike, PortalData, UpdatePortalVariables } from '../shared/types'

type Props = Readonly<{
  portal: PortalData
  mutation: Action<UpdatePortalVariables>
  primaryColor: string
  onPrimaryColorChange: (color: string) => void
  requestUploadUrl: (input: {
    data: { portalId: string; contentType: string; fileSize: number }
  }) => Promise<{ uploadUrl: string; key: string }>
  finalizeUpload: (input: { data: { portalId: string; key: string } }) => Promise<{
    heroImageUrl: string
  }>
  formRef: React.RefObject<FormLike | null>
}>

export function PortalSettings({
  portal,
  mutation,
  primaryColor,
  onPrimaryColorChange,
  requestUploadUrl,
  finalizeUpload,
  formRef,
}: Props) {
  const { can } = usePermissions()
  const isArchived = portal.publicationState === 'archived'

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

      <div className="flex min-h-14 flex-col gap-3 rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Publication</h3>
            <Badge
              variant={portal.publicationState === 'published' ? 'default' : 'outline'}
            >
              {portal.publicationState[0].toUpperCase() +
                portal.publicationState.slice(1)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {portal.publicationState === 'published'
              ? 'Guests with the link can open this portal.'
              : isArchived
                ? 'This portal is archived. Its configuration and history are retained.'
                : 'The public page is unavailable until you publish it.'}
          </p>
        </div>
        {!isArchived && can('portal.update') && (
          <Button
            variant={portal.publicationState === 'published' ? 'outline' : 'default'}
            className="min-h-11 sm:min-h-9"
            disabled={mutation.isPending}
            onClick={() => {
              void mutation({
                data: {
                  portalId: portal.id,
                  publicationState:
                    portal.publicationState === 'published' ? 'disabled' : 'published',
                },
              }).catch(() => undefined)
            }}
          >
            {mutation.isPending
              ? 'Updating…'
              : portal.publicationState === 'published'
                ? 'Disable public page'
                : 'Publish portal'}
          </Button>
        )}
      </div>

      <EditPortalForm
        portal={portal}
        mutation={mutation}
        disabled={isArchived}
        primaryColor={primaryColor}
        formRef={formRef}
        requestUploadUrl={requestUploadUrl}
        finalizeUpload={finalizeUpload}
      />

      <div className="space-y-2">
        <h3 className="font-semibold">Theme</h3>
        <p className="text-sm text-muted-foreground">
          Choose the accent used in the portal preview, then save your changes.
        </p>
        <ThemePresetSelector
          primaryColor={primaryColor}
          onPrimaryColorChange={onPrimaryColorChange}
          disabled={!can('portal.update') || mutation.isPending || isArchived}
        />
      </div>

      {can('portal.update') && !isArchived && (
        <Button
          onClick={() => formRef.current?.handleSubmit()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {mutation.isPending
          ? 'Saving portal settings'
          : mutation.isSuccess
            ? 'Portal settings saved'
            : ''}
      </p>
    </section>
  )
}
