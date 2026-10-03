// React keys for the editor forms that keep an explicit Save. Each key is the
// saved values the form was seeded from, so when the save lands and the server's
// values change, the form remounts on them and no longer reads as edited.
//
// What is NOT in a key matters as much: a value that autosave writes while the
// person types (this portal's own wording override) must stay out, or the field
// would remount under their hands each time a save landed.

import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalExperienceSettings } from '../portal-settings/portal-experience-settings-types'

export function portalPropertyContentDraftKey(
  experience: PortalExperienceSettings,
  locale: OfferedGuestLocale,
): string {
  const baseline = experience.content.find((item) => item.locale === locale)
  return JSON.stringify([locale, baseline?.title ?? '', baseline?.shortDescription ?? ''])
}
