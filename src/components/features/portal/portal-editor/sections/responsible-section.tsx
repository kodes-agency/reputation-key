// Responsible: the managers who receive this portal's workflow notifications.

import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { ResponsibleManagersCard } from '../../portal-settings/responsible-managers-card'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function ResponsibleSection({ resources, canEdit }: PortalEditorSectionProps) {
  const {
    portal,
    responsibleManagers,
    responsibleManagerMembers,
    updateResponsibleManagersMutation,
  } = resources
  if (
    !responsibleManagers ||
    !responsibleManagerMembers ||
    !updateResponsibleManagersMutation
  ) {
    return null
  }
  return (
    <PortalEditorSectionFrame section="responsible">
      <ResponsibleManagersCard
        portalId={portal.id}
        state={responsibleManagers}
        members={responsibleManagerMembers}
        updateAction={updateResponsibleManagersMutation}
        disabled={!canEdit}
      />
    </PortalEditorSectionFrame>
  )
}
