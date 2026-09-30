// Portal context — publication snapshot ↔ row mirror columns
// Pure: the row keeps its own copy of the configuration's locale and brand facts.
// A localized configuration (v2 and v3) never falls back to the v1 English default,
// so a Bulgarian-primary portal is never mirrored as ['en'].

import {
  IMMERSIVE_HUB_SCHEMA_VERSION,
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
    // The v2 brand profile's own version, or the v3 look version: the one
    // number that says which look this snapshot was published with.
    brandProfileVersion:
      configuration.schemaVersion === IMMERSIVE_HUB_SCHEMA_VERSION
        ? configuration.brandProfile.lookVersion
        : configuration.brandProfile.version,
  }
}
