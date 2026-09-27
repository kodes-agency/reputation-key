import type { Action } from '#/components/hooks/use-action'
import { ResponsibleManagersPanel } from '#/components/features/responsible-managers/responsible-managers-panel'

export type PropertyResponsibleManagerState = Readonly<{
  assignments: readonly Readonly<{ userId: string }>[]
  eligibleManagers: readonly Readonly<{
    userId: string
  }>[]
  revision: number
  responsibilityNeeded: boolean
}>

export type ResponsibleManagerMember = Readonly<{
  userId: string
  name: string
  email: string
}>

type UpdateInput = Readonly<{
  data: {
    propertyId: string
    managerUserIds: string[]
    expectedRevision: number
  }
}>

export function PropertyResponsibleManagersCard({
  propertyId,
  state,
  members,
  updateAction,
  disabled,
}: Readonly<{
  propertyId: string
  state: PropertyResponsibleManagerState
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
      headingLevel="h2"
      idPrefix="property-responsible-manager"
      copy={{
        description:
          'These assignments define who receives Property-wide operational updates. Responsibility does not grant Property access or Staff attribution.',
        alertTitle: 'Property responsible manager needed',
        alertDescription:
          'Assign at least one manager so Property-wide updates have a clear owner. Account admins remain available for recovery.',
      }}
      onSave={(managerUserIds, expectedRevision) =>
        updateAction({
          data: { propertyId, managerUserIds: [...managerUserIds], expectedRevision },
        })
      }
    />
  )
}
