// Test-only builder for schema version 3 (Immersive Hub) publication snapshots:
// the configuration builder's output, digested by the production function, plus
// helpers that re-digest an altered configuration so only the content rules
// can object to it. Not imported by production code.

import type {
  ImmersivePortalPublicationConfiguration,
  PortalPublicationSnapshot,
} from '../../domain/portal-publication-snapshot'
import {
  IMMERSIVE_FIXTURE_AT,
  IMMERSIVE_FIXTURE_SCOPE,
  immersiveConfiguration,
} from '../../domain/__fixtures__/immersive-configuration'
import { digestPortalPublicationConfiguration } from '../portal-publication-snapshot'

export * from '../../domain/__fixtures__/immersive-configuration'

/**
 * The snapshot a v3 writer would store for `configuration`, digested by the
 * production function. `overrides` may replace row fields; the configuration
 * is digested as given, so an invalid one still carries a matching digest.
 */
export function immersiveSnapshot(
  configuration: ImmersivePortalPublicationConfiguration = immersiveConfiguration(),
  overrides: Partial<PortalPublicationSnapshot> = {},
): PortalPublicationSnapshot {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    ...IMMERSIVE_FIXTURE_SCOPE,
    version: 6,
    configurationDigest: digestPortalPublicationConfiguration(configuration),
    configuration,
    destinationUri: configuration.reviewGateway.googleReview.uri,
    destinationRetrievedAt: new Date(configuration.googleReviewBinding.retrievedAt),
    destinationSourceEpoch: configuration.googleReviewBinding.sourceEpoch,
    destinationProfileVersion: configuration.googleReviewBinding.profileVersion,
    createdBy: 'manager-1',
    createdAt: IMMERSIVE_FIXTURE_AT,
    ...overrides,
  }
}

/** A snapshot of `immersiveConfiguration(overrides)`, re-digested. */
export function immersiveSnapshotWith(
  overrides: Partial<ImmersivePortalPublicationConfiguration>,
): PortalPublicationSnapshot {
  return immersiveSnapshot(immersiveConfiguration(overrides))
}
