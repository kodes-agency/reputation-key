// Welcome: the portal's name, which the team reads in lists, then the words
// guests read in each language, the primary first: the welcome line above the
// property's name and the link preview. The name and this portal's own lines
// save as they are typed; the property's wording, which every portal starts
// from, keeps an explicit Save.

import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { PortalWelcomeForm } from '../portal-welcome-form'
import { PortalLocalizedContentEditor } from '../../portal-settings/portal-localized-content-editor'
import { isOfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function WelcomeSection({ resources, canEdit }: PortalEditorSectionProps) {
  const { portal, propertyId, portalExperience, portalExperienceActions } = resources
  const primary = portal.primaryGuestLocale ?? 'en'
  // The primary language first, then the others in the order they were added.
  const locales = [
    primary,
    ...(portal.additionalGuestLocales ?? []).filter((locale) => locale !== primary),
  ].filter(isOfferedGuestLocale)
  return (
    <PortalEditorSectionFrame
      section="welcome"
      description={
        canEdit
          ? 'The first words guests read. Changes save as you type.'
          : 'The first words guests read.'
      }
    >
      <PortalWelcomeForm
        portal={portal}
        mutation={resources.autosaveUpdateMutation}
        readOnly={!canEdit}
        propertyHasName={Boolean(portalExperience?.profile?.displayName.trim())}
      />
      {portalExperience && portalExperienceActions ? (
        <div className="space-y-4">
          {locales.map((locale) => (
            <PortalLocalizedContentEditor
              key={locale}
              locale={locale}
              isPrimary={locale === primary}
              propertyId={propertyId}
              portalId={portal.id}
              experience={portalExperience}
              actions={portalExperienceActions}
              disabled={!canEdit}
            />
          ))}
        </div>
      ) : null}
    </PortalEditorSectionFrame>
  )
}
