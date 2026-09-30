// Welcome: the portal's name and description, then the wording guests read in
// each language. The name and this portal's own wording save as they are typed;
// the property-wide fallback wording keeps an explicit Save.

import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { PortalWelcomeForm } from '../portal-welcome-form'
import { PortalLocalizedContentEditor } from '../../portal-settings/portal-localized-content-editor'
import {
  PORTAL_GUEST_LOCALES,
  type PortalExperienceSettings,
} from '../../portal-settings/portal-experience-settings-types'
import type { GuestLocale, OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function WelcomeSection({ resources, canEdit }: PortalEditorSectionProps) {
  const { portal, propertyId, portalExperience, portalExperienceActions } = resources
  const enabled = new Set<GuestLocale>([
    portal.primaryGuestLocale ?? 'en',
    ...(portal.additionalGuestLocales ?? []),
  ])
  return (
    <PortalEditorSectionFrame
      section="welcome"
      description="The first words guests read. Changes save as you type."
    >
      <PortalWelcomeForm
        portal={portal}
        mutation={resources.autosaveUpdateMutation}
        disabled={!canEdit}
      />
      {portalExperience && portalExperienceActions ? (
        <WelcomeWording
          portalId={portal.id}
          propertyId={propertyId}
          experience={portalExperience}
          actions={portalExperienceActions}
          locales={PORTAL_GUEST_LOCALES.filter((locale) => enabled.has(locale))}
          disabled={!canEdit}
        />
      ) : null}
    </PortalEditorSectionFrame>
  )
}

function WelcomeWording({
  portalId,
  propertyId,
  experience,
  actions,
  locales,
  disabled,
}: Readonly<{
  portalId: string
  propertyId: string
  experience: PortalExperienceSettings
  actions: NonNullable<PortalEditorSectionProps['resources']['portalExperienceActions']>
  locales: readonly OfferedGuestLocale[]
  disabled: boolean
}>) {
  return (
    <div className="space-y-4">
      {locales.map((locale) => (
        <PortalLocalizedContentEditor
          key={locale}
          locale={locale}
          propertyId={propertyId}
          portalId={portalId}
          experience={experience}
          actions={actions}
          disabled={disabled}
        />
      ))}
    </div>
  )
}
