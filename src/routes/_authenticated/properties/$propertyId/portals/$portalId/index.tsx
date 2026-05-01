// Portal settings — edit portal info, theme, and routing
import { createFileRoute } from '@tanstack/react-router'
import { updatePortal } from '#/contexts/portal/server/portals'
import { EditPortalForm } from '#/components/features/portal/EditPortalForm'
import { usePortalLayout } from '../$portalId'
import { useMutationAction } from '#/components/hooks/use-mutation-action'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId/',
)({
  component: PortalEditorPage,
})

function PortalEditorPage() {
  const { portal, canEdit } = usePortalLayout()

  const mutation = useMutationAction(updatePortal, {
    successMessage: 'Portal updated',
  })

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Portal Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your portal's basic info, theme, and routing.
        </p>
      </div>

      <EditPortalForm portal={portal} mutation={mutation} canEdit={canEdit} />
    </>
  )
}
