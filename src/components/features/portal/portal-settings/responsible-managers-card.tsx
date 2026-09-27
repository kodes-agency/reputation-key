import type { Action } from '#/components/hooks/use-action'
import { ResponsibleManagersPanel } from '#/components/features/responsible-managers/responsible-managers-panel'
import type {
  PortalResponsibleManagerState,
  ResponsibleManagerMember,
} from '../portal-detail/portal-detail-types'

type UpdateInput = Readonly<{
  data: {
    portalId: string
    managerUserIds: string[]
    expectedRevision: number
  }
}>

export function ResponsibleManagersCard({
  portalId,
  state,
  members,
  updateAction,
  disabled,
}: Readonly<{
  portalId: string
  state: PortalResponsibleManagerState
  members: readonly ResponsibleManagerMember[]
  updateAction: Action<UpdateInput>
  disabled: boolean
}>) {
  return (
    <ResponsibleManagersPanel
      state={state}
      members={members}
      disabled={disabled}
      isPending={updateAction.isPending}
      error={updateAction.error}
      headingLevel="h3"
      idPrefix="responsible-manager"
      copy={{
        description:
          'Assigned managers receive this Portal’s workflow notifications. Responsibility does not grant Property access or Staff attribution.',
        alertTitle: 'Responsible manager needed',
        alertDescription:
          'Assign at least one manager so Portal updates and feedback have a clear owner. Account admins remain available for recovery.',
      }}
      onSave={(managerUserIds, expectedRevision) =>
        updateAction({
          data: { portalId, managerUserIds: [...managerUserIds], expectedRevision },
        })
      }
    />
  )
}
