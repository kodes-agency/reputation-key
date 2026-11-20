// Private note: whether to skip the private rating, and the threshold for an
// optional private note when ratings are collected.

import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { PortalContactRequestsForm } from '../portal-contact-requests-form'
import { PortalPrivateNoteForm } from '../portal-private-note-form'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function PrivateNoteSection({ resources, canEdit }: PortalEditorSectionProps) {
  return (
    <PortalEditorSectionFrame
      section="private-note"
      description={
        canEdit
          ? 'Choose whether guests leave a private rating and when to offer a private note. It saves as you change it.'
          : 'Whether guests leave a private rating and when a private note is offered.'
      }
    >
      <PortalPrivateNoteForm
        portal={resources.portal}
        mutation={resources.autosaveUpdateMutation}
        disabled={!canEdit}
      />
      {resources.contactRequestsLaunch?.launched === true ? (
        <PortalContactRequestsForm
          portal={resources.portal}
          mutation={resources.autosaveUpdateMutation}
          noticeInForce={resources.contactRequestsLaunch.noticeInForce}
          disabled={!canEdit}
        />
      ) : null}
    </PortalEditorSectionFrame>
  )
}
