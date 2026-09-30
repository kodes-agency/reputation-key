// Look: the colours guests see. The brand colours belong to the property and are
// shared by every one of its portals, so they keep an explicit Save; the palette
// below them is this portal's own and saves as it is chosen.

import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { portalBrandDraftKey } from '../portal-draft-keys'
import { PortalPropertyBrandEditor } from '../../portal-settings/portal-property-brand-editor'
import { ThemePresetSelector } from '../../portal-settings/theme-preset-selector'
import type {
  PortalEditorSectionProps,
  PortalEditorThemeControls,
} from '../portal-editor-types'

export function LookSection({
  resources,
  canEdit,
  theme,
  onThemeChange,
}: PortalEditorSectionProps & PortalEditorThemeControls) {
  const { portalExperience, portalExperienceActions, propertyId } = resources
  return (
    <PortalEditorSectionFrame
      section="look"
      description="The colours on this portal. The property brand is shared by every portal at this property."
    >
      {portalExperience && portalExperienceActions ? (
        <PortalPropertyBrandEditor
          key={portalBrandDraftKey(portalExperience)}
          propertyId={propertyId}
          experience={portalExperience}
          action={portalExperienceActions.saveProfile}
          disabled={!canEdit}
        />
      ) : null}
      <div className="space-y-2">
        <h3 className="font-semibold">Palette for this portal</h3>
        <p className="text-sm text-muted-foreground">
          Choose the palette used on the public page. It saves as you choose.
        </p>
        <ThemePresetSelector
          theme={theme}
          onThemeChange={onThemeChange}
          disabled={!canEdit}
        />
      </div>
    </PortalEditorSectionFrame>
  )
}
