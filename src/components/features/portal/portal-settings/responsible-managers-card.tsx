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

/** The portal's wording: what choosing someone here means, in the editor's voice. */
const PORTAL_COPY = {
  description: 'Choosing someone here doesn’t give them access to the property.',
  alertTitle: 'No one is responsible',
  alertDescription:
    'Choose at least one manager, so someone hears about this portal’s private feedback.',
} as const

export function ResponsibleManagersCard({
  portalId,
  state,
  members,
  updateAction,
  disabled,
  onDirtyChange,
}: Readonly<{
  portalId: string
  state: PortalResponsibleManagerState
  members: readonly ResponsibleManagerMember[]
  updateAction: Action<UpdateInput>
  disabled: boolean
  /** Whether ticks wait for Save (the editor's leave guard asks before they are lost). */
  onDirtyChange?: (dirty: boolean) => void
}>) {
  return (
    <ResponsibleManagersPanel
      state={state}
      members={members}
      disabled={disabled}
      isPending={updateAction.isPending}
      error={updateAction.error}
      // The editor's section title already names it ("Responsible").
      headingLevel={null}
      idPrefix="responsible-manager"
      copy={PORTAL_COPY}
      onDirtyChange={onDirtyChange}
      onSave={(managerUserIds, expectedRevision) =>
        updateAction({
          data: { portalId, managerUserIds: [...managerUserIds], expectedRevision },
        })
      }
    />
  )
}
