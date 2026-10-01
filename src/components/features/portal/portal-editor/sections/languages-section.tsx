// Languages: which languages guests can read the portal in, and what each has
// of the wording. The body is the coverage view (portal-languages/).

import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { PortalLanguagesSection } from '../../portal-languages/portal-languages-section'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function LanguagesSection({ resources, canEdit }: PortalEditorSectionProps) {
  const { portal, propertyId, languageCoverage, autosaveUpdateMutation } = resources
  return (
    <PortalEditorSectionFrame
      section="languages"
      description="Guests see a language switch when you offer more than one."
    >
      <PortalLanguagesSection
        portal={portal}
        propertyId={propertyId}
        coverage={languageCoverage}
        update={autosaveUpdateMutation}
        canEdit={canEdit}
      />
    </PortalEditorSectionFrame>
  )
}
