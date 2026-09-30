// Linktree: the links shown under the rating card, and the destinations they are
// allowed to open. Every change to a link is its own saved action, so this
// section has no draft. The tile editor replaces this body in slice 28.

import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { LinkTree } from '../../link-tree/link-tree'
import { PortalApprovedDestinationsEditor } from '../../portal-settings/portal-approved-destinations-editor'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function LinktreeSection({ resources, canEdit }: PortalEditorSectionProps) {
  const { portal, categories, links, approvedDestinations, portalExperienceActions } =
    resources
  return (
    <PortalEditorSectionFrame
      section="linktree"
      description="Links shown under the rating card. Each change to a link is saved when you make it."
    >
      <LinkTree portalId={portal.id} categories={categories} links={links} />
      {approvedDestinations && portalExperienceActions ? (
        <PortalApprovedDestinationsEditor
          portalId={portal.id}
          state={approvedDestinations}
          actions={portalExperienceActions}
          disabled={!canEdit}
        />
      ) : null}
    </PortalEditorSectionFrame>
  )
}
