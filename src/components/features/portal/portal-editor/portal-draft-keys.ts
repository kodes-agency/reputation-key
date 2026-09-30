// React keys for the editor forms that keep an explicit Save. Each key is the
// saved values the form was seeded from, so when the save lands and the server's
// values change, the form remounts on them and no longer reads as edited.
//
// What is NOT in a key matters as much: a value that autosave writes while the
// person types (this portal's own wording override) must stay out, or the field
// would remount under their hands each time a save landed.

import type { GuestLocale, OfferedGuestLocale } from '#/shared/domain/guest-locale'
import {
  isOptionalGuestLocaleEnabled,
  type PortalExperienceSettings,
} from '../portal-settings/portal-experience-settings-types'

export function portalLocaleDraftKey(
  portal: Readonly<{
    primaryGuestLocale?: GuestLocale
    additionalGuestLocales?: readonly GuestLocale[]
  }>,
): string {
  const primary = portal.primaryGuestLocale ?? 'en'
  return JSON.stringify([primary, isOptionalGuestLocaleEnabled(portal)])
}

export function portalBrandDraftKey(experience: PortalExperienceSettings): string {
  return JSON.stringify([
    experience.profile?.displayName ?? '',
    experience.profile?.primaryColor ?? '#2563EB',
    experience.profile?.backgroundColor ?? '#FFFFFF',
    experience.profile?.textColor ?? '#111827',
  ])
}

export function portalPropertyContentDraftKey(
  experience: PortalExperienceSettings,
  locale: OfferedGuestLocale,
): string {
  const baseline = experience.content.find((item) => item.locale === locale)
  return JSON.stringify([locale, baseline?.title ?? '', baseline?.shortDescription ?? ''])
}
