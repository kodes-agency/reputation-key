// Portal context — publication snapshot ↔ row mirror columns
// Pure: the row keeps its own copy of the configuration's locale and brand facts.

import {
  isLocalizedConfiguration,
  LEGACY_V1_GUEST_LOCALE,
  LEGACY_V1_LANGUAGE_PACK,
  type PortalPublicationConfiguration,
} from '../../domain/portal-publication-snapshot'

/**
 * The columns a snapshot row keeps as its own copy of the configuration's
 * locale and brand facts. The reader refuses a row that disagrees with its
 * configuration, so both are derived from the configuration here.
 */
export function snapshotMirrorColumns(configuration: PortalPublicationConfiguration) {
  if (!isLocalizedConfiguration(configuration)) {
    return {
      localeSet: [LEGACY_V1_GUEST_LOCALE],
      languagePackVersions: { [LEGACY_V1_GUEST_LOCALE]: LEGACY_V1_LANGUAGE_PACK },
      localizedContent: {},
      brandProfileVersion: null,
    }
  }
  return {
    localeSet: configuration.localeSet,
    languagePackVersions: configuration.languagePackVersions,
    localizedContent: configuration.localizedContent,
    brandProfileVersion: configuration.brandProfile.version,
  }
}
