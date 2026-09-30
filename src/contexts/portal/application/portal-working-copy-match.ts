// Does the working copy still say what a published snapshot says?
//
// One comparison for the two callers that ask: the history use case (is there a
// pending change?) and the publish transaction (did the content move while the
// snapshot was being committed?). The working copy itself is read once, by
// infrastructure/portal-working-copy.reader.ts.

import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import {
  IMMERSIVE_HUB_SCHEMA_VERSION,
  isLocalizedConfiguration,
  type PortalPublicationSnapshot,
  type PortalPublicationSource,
} from '../domain/portal-publication-snapshot'

/** What a snapshot published, in the shape of a working copy. */
export function publishedContent(snapshot: PortalPublicationSnapshot) {
  const configuration = snapshot.configuration
  if (configuration.schemaVersion === IMMERSIVE_HUB_SCHEMA_VERSION) {
    // No v3 working copy exists until the v3 writer (slice 19), so nothing can
    // equal this yet: a v3 snapshot reads as changed against any v2 working
    // copy. The writer slice makes `comparableWorkingContent` produce this shape.
    return {
      schemaVersion: configuration.schemaVersion,
      portal: configuration.portal,
      links: configuration.links,
      linktree: configuration.linktree,
      privateFeedbackThreshold: configuration.reviewGateway.privateFeedbackThreshold,
      organizationId: snapshot.organizationId,
      propertyId: snapshot.propertyId,
      experience: {
        primaryGuestLocale: configuration.guestLocale,
        localeSet: configuration.localeSet,
        languagePackVersions: configuration.languagePackVersions,
        localizedContent: configuration.localizedContent,
        brandProfile: configuration.brandProfile,
        timeZone: configuration.timeZone,
      },
    }
  }
  return {
    portal: configuration.portal,
    categories: configuration.categories,
    links: configuration.links,
    privateFeedbackThreshold: configuration.reviewGateway.privateFeedbackThreshold,
    organizationId: snapshot.organizationId,
    propertyId: snapshot.propertyId,
    ...(isLocalizedConfiguration(configuration)
      ? {
          experience: {
            primaryGuestLocale: configuration.guestLocale,
            localeSet: configuration.localeSet,
            languagePackVersions: configuration.languagePackVersions,
            localizedContent: configuration.localizedContent,
            brandProfile: configuration.brandProfile,
          },
        }
      : {}),
  }
}

/** The working copy, narrowed to exactly what a snapshot of it would publish. */
export function comparableWorkingContent(workingCopy: PortalPublicationSource) {
  const experience = workingCopy.experience
  return {
    portal: workingCopy.portal,
    categories: workingCopy.categories,
    links: workingCopy.links,
    privateFeedbackThreshold: workingCopy.privateFeedbackThreshold,
    organizationId: workingCopy.organizationId,
    propertyId: workingCopy.propertyId,
    ...(experience
      ? {
          experience: {
            primaryGuestLocale: experience.primaryGuestLocale,
            localeSet: experience.localeSet,
            languagePackVersions: Object.fromEntries(
              experience.localeSet.map((locale) => [
                locale,
                experience.languagePackVersions[locale],
              ]),
            ),
            localizedContent: Object.fromEntries(
              experience.localeSet.map((locale) => [
                locale,
                experience.localizedContent[locale],
              ]),
            ),
            brandProfile: experience.brandProfile,
          },
        }
      : {}),
  }
}

export function workingCopyMatchesSnapshot(
  workingCopy: PortalPublicationSource,
  snapshot: PortalPublicationSnapshot,
): boolean {
  return (
    canonicalizeRfc8785(comparableWorkingContent(workingCopy)) ===
    canonicalizeRfc8785(publishedContent(snapshot))
  )
}
