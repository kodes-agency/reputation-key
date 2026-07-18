// Property processing-region routing (BQR-3.5 / PRE17B B8).
//
// Pure helpers: country → provider-neutral processing region with provenance.
// No silent region change after a property is already resolved.
//
// BQC-4.1 / ADR 0048: of the four region identifiers, only 'us' is an
// APPROVED processing cell for beta. 'europe' is denied until its
// infrastructure and privacy/data-flow evidence pass (ADR 0031/0032);
// 'global' is a denied placeholder, not a cell; 'unresolved' fails closed.

import { resolveRegion } from '#/shared/domain/processing-profile'
import { propertyError } from './errors'
import { DEFAULT_PROPERTY_ROUTING, type Property } from './types'

/** Version of the country → region map stored on each property. */
export const ROUTING_POLICY_VERSION = 1

export type PropertyRoutingFields = Pick<
  Property,
  | 'countryCode'
  | 'countrySource'
  | 'timezoneSource'
  | 'timezoneResolvedAt'
  | 'processingRegion'
  | 'processingRegionSource'
  | 'routingPolicyVersion'
  | 'processingRegionResolvedAt'
  | 'sourceEpoch'
>

/**
 * Resolve processing-profile fields from a country code.
 *
 * - Null/empty country → explicit `unresolved` (not a silent default region).
 * - Non-empty country → `resolveRegion` (us | europe | global) with
 *   `country_default` provenance and a resolution timestamp.
 */
export function resolvePropertyRouting(args: {
  countryCode: string | null
  countrySource: string
  now: Date
  sourceEpoch?: number
  timezoneSource?: string | null
  timezoneResolvedAt?: Date | null
}): PropertyRoutingFields {
  const code = args.countryCode?.trim().toUpperCase() || null

  if (!code) {
    return {
      ...DEFAULT_PROPERTY_ROUTING,
      countrySource: args.countrySource,
      timezoneSource: args.timezoneSource ?? DEFAULT_PROPERTY_ROUTING.timezoneSource,
      timezoneResolvedAt: args.timezoneResolvedAt ?? null,
      routingPolicyVersion: ROUTING_POLICY_VERSION,
      sourceEpoch: args.sourceEpoch ?? 0,
    }
  }

  return {
    countryCode: code,
    countrySource: args.countrySource,
    timezoneSource: args.timezoneSource ?? DEFAULT_PROPERTY_ROUTING.timezoneSource,
    timezoneResolvedAt: args.timezoneResolvedAt ?? null,
    processingRegion: resolveRegion(code),
    processingRegionSource: 'country_default',
    routingPolicyVersion: ROUTING_POLICY_VERSION,
    processingRegionResolvedAt: args.now,
    sourceEpoch: args.sourceEpoch ?? 0,
  }
}

/**
 * True when the property already has a resolved region and applying
 * `newCountryCode` would change that region (silent change — forbidden).
 */
export function wouldChangeResolvedRegion(
  existingRegion: string | null,
  newCountryCode: string,
): boolean {
  if (!existingRegion || existingRegion === 'unresolved') return false
  return resolveRegion(newCountryCode) !== existingRegion
}

/**
 * Regions approved to execute protected workloads in the beta cell topology
 * (ADR 0048). Deliberately a Set so widening requires an explicit decision.
 * Module-private — `isRegionProcessable` is the public predicate.
 */
const PROCESSABLE_REGIONS: ReadonlySet<string> = new Set(['us'])

/**
 * True when the region is an approved processing cell. Everything else —
 * 'unresolved', the denied 'europe' cell, the denied 'global' placeholder,
 * or a missing region — is not processable (fail closed).
 */
export function isRegionProcessable(region: string | null): boolean {
  return region != null && PROCESSABLE_REGIONS.has(region)
}

/**
 * Assert that the property's processing region resolves into an approved
 * cell. Throws `region_unresolved` PropertyError otherwise — every
 * property-scoped protected workload fails closed on this (BQC-4.1).
 */
export function assertRegionResolved(property: {
  processingRegion: string | null
}): void {
  if (!isRegionProcessable(property.processingRegion)) {
    throw propertyError(
      'region_unresolved',
      'property processing region is not resolved into an approved cell',
      { processingRegion: property.processingRegion },
    )
  }
}
