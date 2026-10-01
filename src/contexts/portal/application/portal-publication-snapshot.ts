import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { portalError } from '../domain/errors'
import {
  IMMERSIVE_HUB_SCHEMA_VERSION,
  LEGACY_PORTAL_PUBLICATION_SCHEMA_VERSION,
  PORTAL_PUBLICATION_SCHEMA_VERSION,
  LEGACY_V1_GUEST_LOCALE,
  LEGACY_V1_LANGUAGE_PACK,
  type ImmersivePortalPublicationConfiguration,
  type LocalizedPortalPublicationConfiguration,
  type PortalPublicationConfiguration,
  type PortalPublicationSnapshot,
  type VerifiedPublicationDestination,
} from '../domain/portal-publication-snapshot'
import {
  resolvePortalPublication,
  type PortalPublicationSource,
  type PublicationBlocker,
} from '../domain/portal-publication-source'
import { assertCompletePortalPublicationExperience } from '../domain/portal-experience'
import { isCompleteImmersiveConfiguration } from '../domain/portal-immersive-snapshot'

/** SHA-256 over the RFC 8785 canonical form: the digest every snapshot row stores. */
export function digestPortalPublicationConfiguration(
  configuration: PortalPublicationConfiguration,
): string {
  return createHash('sha256')
    .update(canonicalizeRfc8785(configuration), 'utf8')
    .digest('hex')
}

/**
 * The facts every publication input states about itself, whatever schema
 * version it will write: who it is for, which version it is, and the verified
 * Google destination pinned to it. The test builder for earlier versions shares
 * it, so they cannot disagree about what an acceptable envelope is.
 */
export type PublicationEnvelope = Readonly<{
  id: string
  portalId: string
  organizationId: string
  propertyId: string
  version: number
  source: Readonly<{
    portal: Readonly<{ id: string }>
    organizationId: string
    propertyId: string
    privateFeedbackThreshold: number
  }>
  destination: VerifiedPublicationDestination
  createdBy: string
  createdAt: Date
}>

type PublicationInput = PublicationEnvelope &
  Readonly<{ source: PortalPublicationSource }>

/** Every identifier is present and the source agrees with the declared scope. */
function hasConsistentPublicationScope(input: PublicationEnvelope): boolean {
  return (
    input.id.length > 0 &&
    input.portalId.length > 0 &&
    input.organizationId.length > 0 &&
    input.propertyId.length > 0 &&
    input.createdBy.length > 0 &&
    input.source.portal.id === input.portalId &&
    input.source.organizationId === input.organizationId &&
    input.source.propertyId === input.propertyId
  )
}

/** Every field of the verified Google destination binding is present and in range. */
function isCompleteVerifiedDestination(
  destination: VerifiedPublicationDestination,
): boolean {
  return (
    destination.state === 'verified' &&
    destination.uri.length > 0 &&
    !Number.isNaN(destination.retrievedAt.getTime()) &&
    Number.isSafeInteger(destination.sourceEpoch) &&
    destination.sourceEpoch >= 0 &&
    Number.isSafeInteger(destination.profileVersion) &&
    destination.profileVersion >= 1
  )
}

export function assertPublicationEnvelope(input: PublicationEnvelope): void {
  if (!hasConsistentPublicationScope(input)) {
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
    !isCompleteVerifiedDestination(input.destination) ||
    Number.isNaN(input.createdAt.getTime())
  ) {
    throw portalError(
      'google_review_destination_unavailable',
      'Portal publication requires a complete verified Google destination binding',
    )
  }
}

/** What a manager is told about each thing that stops a publication. */
function describeBlocker(blocker: PublicationBlocker): string {
  switch (blocker.code) {
    case 'primary_text_missing':
      return `Write the ${blocker.key.startsWith('link:') ? 'link wording' : blocker.key} in the primary language (${blocker.locale}) before publishing`
    case 'language_pack_missing':
      return `The guest wording for ${blocker.locale} isn’t ready yet, so that language can’t be published`
    case 'time_zone_invalid':
      return 'Set a valid time zone for this Property before publishing'
  }
}

/**
 * The schema version 3 snapshot publishing `input.source` would store. Nothing
 * else is written any more: a source with a gap in its primary language, a
 * language without a pack or a Property without a usable time zone is refused
 * with the first thing to fix, never published as an earlier design.
 */
export function buildPortalPublicationSnapshot(
  input: PublicationInput,
): PortalPublicationSnapshot {
  assertPublicationEnvelope(input)
  const { blockers, content } = resolvePortalPublication(input.source)
  const [first] = blockers
  if (first) {
    throw portalError('publication_snapshot_unavailable', describeBlocker(first))
  }
  const configuration: ImmersivePortalPublicationConfiguration = {
    schemaVersion: IMMERSIVE_HUB_SCHEMA_VERSION,
    ...content,
    reviewGateway: {
      privateFeedbackThreshold: input.source.privateFeedbackThreshold,
      googleReview: { status: 'available', uri: input.destination.uri },
    },
    googleReviewBinding: {
      retrievedAt: input.destination.retrievedAt.toISOString(),
      sourceEpoch: input.destination.sourceEpoch,
      profileVersion: input.destination.profileVersion,
    },
  }
  const snapshot: PortalPublicationSnapshot = {
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
  // A backstop for what no blocker names (a blank display name, a text past the
  // reader's limit): a snapshot the reader would refuse is never written, and
  // the manager hears it from here rather than from the commit's own guard.
  if (!verifyPortalPublicationSnapshot(snapshot)) {
    throw portalError(
      'publication_snapshot_unavailable',
      'The Portal’s content is incomplete or out of range, so it cannot be published',
    )
  }
  return snapshot
}

/** Scope, review-gateway range and destination binding all agree with the snapshot row. */
function hasConsistentSnapshotBinding(snapshot: PortalPublicationSnapshot): boolean {
  const configuration = snapshot.configuration
  return (
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
  )
}

/** The content required by the configuration's own schema version is present and complete. */
function hasCompleteSchemaVersionedContent(
  configuration: PortalPublicationConfiguration,
): boolean {
  // Exhaustive on purpose: adding a version to the union makes `unhandled`
  // stop being `never`, so this switch stops compiling. At runtime a version
  // this build cannot check still fails closed.
  switch (configuration.schemaVersion) {
    case LEGACY_PORTAL_PUBLICATION_SCHEMA_VERSION:
      return (
        configuration.guestLocale === LEGACY_V1_GUEST_LOCALE &&
        configuration.languagePackVersion === LEGACY_V1_LANGUAGE_PACK
      )
    case PORTAL_PUBLICATION_SCHEMA_VERSION:
      return hasCompleteLocalizedExperience(configuration)
    case IMMERSIVE_HUB_SCHEMA_VERSION:
      return isCompleteImmersiveConfiguration(configuration)
    default: {
      const unhandled: never = configuration
      void unhandled
      return false
    }
  }
}

function hasCompleteLocalizedExperience(
  configuration: LocalizedPortalPublicationConfiguration,
): boolean {
  try {
    assertCompletePortalPublicationExperience({
      primaryGuestLocale: configuration.guestLocale,
      localeSet: configuration.localeSet,
      languagePackVersions: configuration.languagePackVersions,
      localizedContent: configuration.localizedContent,
      brandProfile: configuration.brandProfile,
    })
    return true
  } catch {
    return false
  }
}

/** Fail-closed integrity check for content read back from durable storage. */
export function verifyPortalPublicationSnapshot(
  snapshot: PortalPublicationSnapshot,
): boolean {
  if (!hasConsistentSnapshotBinding(snapshot)) return false
  const configuration = snapshot.configuration
  if (!hasCompleteSchemaVersionedContent(configuration)) return false
  return (
    digestPortalPublicationConfiguration(configuration) === snapshot.configurationDigest
  )
}
