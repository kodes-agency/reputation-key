// Responsible: the managers told when a guest leaves private feedback on this
// portal, or when it needs attention. Unlike the other sections it keeps an
// explicit Save: every save notifies people, and a list emptied on the way to
// another choice would raise a "no one is responsible" notice of its own. So
// ticks waiting for Save are registered with the editor's leave guard, and
// switching section with them asks first instead of dropping them.

import { useCallback, useRef } from 'react'
import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { ResponsibleManagersCard } from '../../portal-settings/responsible-managers-card'
import { useExplicitDirtyGuard } from '../use-portal-form-autosave'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function ResponsibleSection({ resources, canEdit }: PortalEditorSectionProps) {
  const {
    portal,
    responsibleManagers,
    responsibleManagerMembers,
    updateResponsibleManagersMutation,
  } = resources
  const dirty = useRef(false)
  const onDirtyChange = useCallback((next: boolean) => {
    dirty.current = next
  }, [])
  useExplicitDirtyGuard('responsible-managers', () => dirty.current)
  if (
    !responsibleManagers ||
    !responsibleManagerMembers ||
    !updateResponsibleManagersMutation
  ) {
    return null
  }
  return (
    <PortalEditorSectionFrame
      section="responsible"
      description={
        canEdit
          ? 'The people told when a guest leaves private feedback on this portal, or when it needs attention. Changes apply when you save them.'
          : 'The people told when a guest leaves private feedback on this portal, or when it needs attention.'
      }
    >
      <ResponsibleManagersCard
        portalId={portal.id}
        state={responsibleManagers}
        members={responsibleManagerMembers}
        updateAction={updateResponsibleManagersMutation}
        disabled={!canEdit}
        onDirtyChange={onDirtyChange}
      />
    </PortalEditorSectionFrame>
  )
}
