// Languages: which languages guests can read the portal in. The coverage view
// replaces this body in slice 29; until then it is the existing language editor,
// with its own explicit Save.

import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { portalLocaleDraftKey } from '../portal-draft-keys'
import { PortalLocaleConfiguration } from '../../portal-settings/portal-locale-configuration'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function LanguagesSection({ resources, canEdit }: PortalEditorSectionProps) {
  const { portal, updateMutation } = resources
  return (
    <PortalEditorSectionFrame
      section="languages"
      description="The languages guests can read this portal in."
    >
      <PortalLocaleConfiguration
        key={portalLocaleDraftKey(portal)}
        portal={portal}
        update={updateMutation}
        disabled={!canEdit}
      />
    </PortalEditorSectionFrame>
  )
}
