// Test-only builder for schema version 1 and 2 publication snapshots.
//
// Publishing writes version 3 only (round 4, slice 19), but every earlier
// snapshot stays servable and must keep verifying for as long as a guest
// response points at it. The tests that prove that, and the legacy guest page,
// need such snapshots: this is the builder the production code used until the
// writer switched, kept verbatim so they are the very bytes it wrote. Not
// imported by production code.

import { portalError } from '../../domain/errors'
import {
  LEGACY_PORTAL_PUBLICATION_SCHEMA_VERSION,
  LEGACY_V1_GUEST_LOCALE,
  LEGACY_V1_LANGUAGE_PACK,
  PORTAL_PUBLICATION_SCHEMA_VERSION,
  type LegacyPortalPublicationExperienceSource,
  type LegacyPortalPublicationSource,
  type PortalPublicationConfiguration,
  type PortalPublicationSnapshot,
} from '../../domain/portal-publication-snapshot'
import { assertCompletePortalPublicationExperience } from '../../domain/portal-experience'
import {
  assertPublicationEnvelope,
  digestPortalPublicationConfiguration,
  type PublicationEnvelope,
} from '../portal-publication-snapshot'

export type LegacyPublicationInput = PublicationEnvelope &
  Readonly<{ source: LegacyPortalPublicationSource }>

function assertPublicationInput(input: LegacyPublicationInput): void {
  assertPublicationEnvelope(input)
  if (input.source.experience) {
    assertCompletePortalPublicationExperience(input.source.experience)
  }
}

/** The pack of the primary locale; never a default, because completeness was asserted first. */
function primaryLanguagePack(
  experience: LegacyPortalPublicationExperienceSource,
): string {
  const pack = experience.languagePackVersions[experience.primaryGuestLocale]
  if (pack === undefined) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Portal publication has no language pack for its primary locale',
    )
  }
  return pack
}

export function buildLegacyPortalPublicationSnapshot(
  input: LegacyPublicationInput,
): PortalPublicationSnapshot {
  assertPublicationInput(input)
  const common = {
    portal: input.source.portal,
    categories: input.source.categories,
    links: input.source.links,
    reviewGateway: {
      privateFeedbackThreshold: input.source.privateFeedbackThreshold,
      googleReview: { status: 'available' as const, uri: input.destination.uri },
    },
    googleReviewBinding: {
      retrievedAt: input.destination.retrievedAt.toISOString(),
      sourceEpoch: input.destination.sourceEpoch,
      profileVersion: input.destination.profileVersion,
    },
  }
  const experience = input.source.experience
  const configuration: PortalPublicationConfiguration = experience
    ? {
        ...common,
        schemaVersion: PORTAL_PUBLICATION_SCHEMA_VERSION,
        guestLocale: experience.primaryGuestLocale,
        languagePackVersion: primaryLanguagePack(experience),
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
      }
    : {
        ...common,
        schemaVersion: LEGACY_PORTAL_PUBLICATION_SCHEMA_VERSION,
        guestLocale: LEGACY_V1_GUEST_LOCALE,
        languagePackVersion: LEGACY_V1_LANGUAGE_PACK,
      }
  return {
    // fallow-ignore-next-line code-duplication
    id: input.id,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    portalId: input.portalId,
    version: input.version,
    configurationDigest: digestPortalPublicationConfiguration(configuration),
    configuration,
    destinationUri: input.destination.uri,
    destinationRetrievedAt: input.destination.retrievedAt,
    destinationSourceEpoch: input.destination.sourceEpoch,
    destinationProfileVersion: input.destination.profileVersion,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  }
}
