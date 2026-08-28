import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { portalError } from '../domain/errors'
import {
  LEGACY_PORTAL_PUBLICATION_SCHEMA_VERSION,
  PORTAL_PUBLICATION_SCHEMA_VERSION,
  PRIMARY_GUEST_LANGUAGE_PACK_VERSION,
  PRIMARY_GUEST_LOCALE,
  type PortalPublicationConfiguration,
  type PortalPublicationSnapshot,
  type PortalPublicationSource,
  type VerifiedPublicationDestination,
} from '../domain/portal-publication-snapshot'
import { assertCompletePortalPublicationExperience } from '../domain/portal-experience'

function digestConfiguration(configuration: PortalPublicationConfiguration): string {
  return createHash('sha256')
    .update(canonicalizeRfc8785(configuration), 'utf8')
    .digest('hex')
}

function assertPublicationInput(
  input: Readonly<{
    id: string
    portalId: string
    organizationId: string
    propertyId: string
    version: number
    source: PortalPublicationSource
    destination: VerifiedPublicationDestination
    createdBy: string
    createdAt: Date
  }>,
): void {
  if (
    input.id.length === 0 ||
    input.portalId.length === 0 ||
    input.organizationId.length === 0 ||
    input.propertyId.length === 0 ||
    input.createdBy.length === 0 ||
    input.source.portal.id !== input.portalId ||
    input.source.organizationId !== input.organizationId ||
    input.source.propertyId !== input.propertyId
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Portal publication scope is incomplete or inconsistent',
    )
  }
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Portal publication version must be a positive integer',
    )
  }
  if (
    !Number.isInteger(input.source.privateFeedbackThreshold) ||
    input.source.privateFeedbackThreshold < 1 ||
    input.source.privateFeedbackThreshold > 5
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Portal publication requires a private-feedback threshold from 1 to 5',
    )
  }
  if (
    input.destination.state !== 'verified' ||
    input.destination.uri.length === 0 ||
    Number.isNaN(input.destination.retrievedAt.getTime()) ||
    !Number.isSafeInteger(input.destination.sourceEpoch) ||
    input.destination.sourceEpoch < 0 ||
    !Number.isSafeInteger(input.destination.profileVersion) ||
    input.destination.profileVersion < 1 ||
    Number.isNaN(input.createdAt.getTime())
  ) {
    throw portalError(
      'google_review_destination_unavailable',
      'Portal publication requires a complete verified Google destination binding',
    )
  }
  if (input.source.experience) {
    assertCompletePortalPublicationExperience(input.source.experience)
  }
}

export function buildPortalPublicationSnapshot(
  input: Readonly<{
    id: string
    portalId: string
    organizationId: string
    propertyId: string
    version: number
    source: PortalPublicationSource
    destination: VerifiedPublicationDestination
    createdBy: string
    createdAt: Date
  }>,
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
        languagePackVersion:
          experience.languagePackVersions[experience.primaryGuestLocale],
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
        guestLocale: PRIMARY_GUEST_LOCALE,
        languagePackVersion: PRIMARY_GUEST_LANGUAGE_PACK_VERSION,
      }
  return {
    id: input.id,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    portalId: input.portalId,
    version: input.version,
    configurationDigest: digestConfiguration(configuration),
    configuration,
    destinationUri: input.destination.uri,
    destinationRetrievedAt: input.destination.retrievedAt,
    destinationSourceEpoch: input.destination.sourceEpoch,
    destinationProfileVersion: input.destination.profileVersion,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  }
}

/** Fail-closed integrity check for content read back from durable storage. */
export function verifyPortalPublicationSnapshot(
  snapshot: PortalPublicationSnapshot,
): boolean {
  const configuration = snapshot.configuration
  const commonIsValid =
    snapshot.id.length > 0 &&
    snapshot.portalId.length > 0 &&
    snapshot.organizationId.length > 0 &&
    snapshot.propertyId.length > 0 &&
    snapshot.createdBy.length > 0 &&
    Number.isSafeInteger(snapshot.version) &&
    snapshot.version >= 1 &&
    configuration.portal.id === snapshot.portalId &&
    Number.isInteger(configuration.reviewGateway.privateFeedbackThreshold) &&
    configuration.reviewGateway.privateFeedbackThreshold >= 1 &&
    configuration.reviewGateway.privateFeedbackThreshold <= 5 &&
    configuration.reviewGateway.googleReview.status === 'available' &&
    configuration.reviewGateway.googleReview.uri === snapshot.destinationUri &&
    configuration.googleReviewBinding.retrievedAt ===
      snapshot.destinationRetrievedAt.toISOString() &&
    configuration.googleReviewBinding.sourceEpoch === snapshot.destinationSourceEpoch &&
    configuration.googleReviewBinding.profileVersion ===
      snapshot.destinationProfileVersion &&
    !Number.isNaN(snapshot.createdAt.getTime())
  if (!commonIsValid) return false
  if (configuration.schemaVersion === LEGACY_PORTAL_PUBLICATION_SCHEMA_VERSION) {
    if (
      configuration.guestLocale !== PRIMARY_GUEST_LOCALE ||
      configuration.languagePackVersion !== PRIMARY_GUEST_LANGUAGE_PACK_VERSION
    ) {
      return false
    }
  } else if (configuration.schemaVersion === PORTAL_PUBLICATION_SCHEMA_VERSION) {
    try {
      assertCompletePortalPublicationExperience({
        primaryGuestLocale: configuration.guestLocale,
        localeSet: configuration.localeSet,
        languagePackVersions: {
          en: configuration.languagePackVersions.en ?? '',
          bg: configuration.languagePackVersions.bg ?? '',
        },
        localizedContent: configuration.localizedContent,
        brandProfile: configuration.brandProfile,
      })
    } catch {
      return false
    }
  } else {
    return false
  }
  return digestConfiguration(configuration) === snapshot.configurationDigest
}
