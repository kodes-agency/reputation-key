// Private note: the one setting behind the optional private note a guest can
// leave after a low rating.

import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { PortalPrivateNoteForm } from '../portal-private-note-form'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function PrivateNoteSection({ resources, canEdit }: PortalEditorSectionProps) {
  return (
    <PortalEditorSectionFrame
      section="private-note"
      description={
        canEdit
          ? 'Choose how low a rating has to be before a guest is offered a private note. It saves as you change it.'
          : 'How low a rating has to be before a guest is offered a private note.'
      }
    >
      <PortalPrivateNoteForm
        portal={resources.portal}
        mutation={resources.autosaveUpdateMutation}
        disabled={!canEdit}
      />
    </PortalEditorSectionFrame>
  )
}
