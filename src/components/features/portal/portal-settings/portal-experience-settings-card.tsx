import type { Action } from '#/components/hooks/use-action'
import type { PortalData, UpdatePortalVariables } from '../shared/types'
import { PortalApprovedDestinationsEditor } from './portal-approved-destinations-editor'
import {
  PORTAL_GUEST_LOCALES,
  type GuestLocale,
  type PortalApprovedDestinationList,
  type PortalExperienceActions,
  type PortalExperienceSettings,
} from './portal-experience-settings-types'
import { PortalLocaleConfiguration } from './portal-locale-configuration'
import { PortalLocalizedContentEditor } from './portal-localized-content-editor'
import { PortalPropertyBrandEditor } from './portal-property-brand-editor'

export type {
  PortalApprovedDestinationList,
  PortalExperienceActions,
  PortalExperienceSettings,
} from './portal-experience-settings-types'

function portalLocaleDraftKey(portal: PortalData): string {
  const primary = portal.primaryGuestLocale ?? 'en'
  const bulgarianEnabled =
    primary === 'bg' || portal.additionalGuestLocales?.includes('bg') === true
  return JSON.stringify([primary, bulgarianEnabled])
}

function portalBrandDraftKey(experience: PortalExperienceSettings): string {
  return JSON.stringify([
    experience.profile?.displayName ?? '',
    experience.profile?.primaryColor ?? '#2563EB',
    experience.profile?.backgroundColor ?? '#FFFFFF',
    experience.profile?.textColor ?? '#111827',
  ])
}

function portalLocalizedContentDraftKey(
  experience: PortalExperienceSettings,
  locale: GuestLocale,
): string {
  const baseline = experience.content.find((item) => item.locale === locale)
  const override = experience.overrides.find((item) => item.locale === locale)
  return JSON.stringify([
    locale,
    baseline?.title ?? '',
    baseline?.shortDescription ?? '',
    override?.title ?? '',
    override?.shortDescription ?? '',
  ])
}

export function PortalExperienceSettingsCard({
  portal,
  propertyId,
  experience,
  destinations,
  updatePortal,
  actions,
  disabled,
}: Readonly<{
  portal: PortalData
  propertyId: string
  experience: PortalExperienceSettings
  destinations: PortalApprovedDestinationList
  updatePortal: Action<UpdatePortalVariables>
  actions: PortalExperienceActions
  disabled: boolean
}>) {
  const enabledLocales = new Set<GuestLocale>([
    portal.primaryGuestLocale ?? 'en',
    ...(portal.additionalGuestLocales ?? []),
  ])

  return (
    <section className="space-y-4" aria-labelledby="portal-guest-experience-title">
      <div>
        <h3 id="portal-guest-experience-title" className="font-semibold">
          Guest experience
        </h3>
        <p className="text-sm text-muted-foreground">
          Manage the languages, shared brand, Portal-specific wording, and safe secondary
          links included in the next publication.
        </p>
      </div>
      <PortalLocaleConfiguration
        key={portalLocaleDraftKey(portal)}
        portal={portal}
        update={updatePortal}
        disabled={disabled}
      />
      <PortalPropertyBrandEditor
        key={portalBrandDraftKey(experience)}
        propertyId={propertyId}
        experience={experience}
        action={actions.saveProfile}
        disabled={disabled}
      />
      {PORTAL_GUEST_LOCALES.filter((locale) => enabledLocales.has(locale)).map(
        (locale) => (
          <PortalLocalizedContentEditor
            key={portalLocalizedContentDraftKey(experience, locale)}
            locale={locale}
            propertyId={propertyId}
            portalId={portal.id}
            experience={experience}
            actions={actions}
            disabled={disabled}
          />
        ),
      )}
      <PortalApprovedDestinationsEditor
        portalId={portal.id}
        state={destinations}
        actions={actions}
        disabled={disabled}
      />
    </section>
  )
}
