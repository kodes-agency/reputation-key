// Property processing-region routing (BQR-3.5 / PRE17B B8).
//
// Pure helpers: country → provider-neutral processing region with provenance.
// No silent region change after a property is already resolved.
//
// Private beta executes only in catalogue cells whose lifecycle state is
// `accepting`. Provisioning or unresolved cells fail closed.

import { resolveRegion } from '#/shared/domain/processing-profile'
import {
  DATA_CELL_CATALOGUE_POLICY_VERSION,
  isDataCellAccepting,
} from '#/shared/domain/data-cell-catalogue'
import { propertyError } from './errors'
import { DEFAULT_PROPERTY_ROUTING, type Property } from './types'

/** Version of the country → region map stored on each property. */
export const ROUTING_POLICY_VERSION = DATA_CELL_CATALOGUE_POLICY_VERSION

export type PropertyRoutingFields = Pick<
  Property,
  | 'countryCode'
  | 'countrySource'
  | 'timezoneSource'
  | 'timezoneResolvedAt'
  | 'processingRegion'
  | 'dataCellId'
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

  const region = resolveRegion(code)
  return {
    countryCode: code,
    countrySource: args.countrySource,
    timezoneSource: args.timezoneSource ?? DEFAULT_PROPERTY_ROUTING.timezoneSource,
    timezoneResolvedAt: args.timezoneResolvedAt ?? null,
    processingRegion: region,
    dataCellId: region === 'unresolved' ? null : region,
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
 * True when the property has a resolved, accepting Data Cell. A known cell in
 * provisioning/draining/denied state is not executable and fails closed.
 */
export function isRegionProcessable(region: string | null): boolean {
  return isDataCellAccepting(region)
}

/**
 * BQC-4.4: content-free machine reason a property's region blocks processing,
 * surfaced on read paths (property detail DTO, operator region diagnostic).
 * Null when the region is processable. Mirrors the ProcessingRouter's blocked
 * reasons (shared/routing/processing-router.ts): 'unresolved'/missing fails
 * closed as `region_unresolved`; every other non-approved value is a denied
 * cell or placeholder (`region_denied`).
 */
export type RegionBlockedReason = 'region_unresolved' | 'region_denied'

export function regionBlockedReason(region: string | null): RegionBlockedReason | null {
  if (isRegionProcessable(region)) return null
  return region == null || region === 'unresolved' ? 'region_unresolved' : 'region_denied'
}

/**
 * Expand-phase reason for a canonical assignment plus its legacy diagnostic
 * fact. A missing canonical assignment is unresolved only when the legacy row
 * is also absent/unresolved; any other disagreement is denied.
 */
export function dataCellBlockedReason(
  dataCellId: string | null,
  legacyProcessingRegion: string | null,
): RegionBlockedReason | null {
  if (isRegionProcessable(dataCellId)) return null
  if (dataCellId !== null) return 'region_denied'
  return legacyProcessingRegion == null || legacyProcessingRegion === 'unresolved'
    ? 'region_unresolved'
    : 'region_denied'
}

/**
 * Assert that the property's processing region resolves into an approved
 * cell. Throws `region_unresolved` PropertyError otherwise — every
 * property-scoped protected workload fails closed on this (BQC-4.1).
 */
export function assertRegionResolved(property: { dataCellId: string | null }): void {
  if (!isRegionProcessable(property.dataCellId)) {
    throw propertyError(
      'region_unresolved',
      'property is not assigned to an accepting Data Cell',
      { dataCellId: property.dataCellId },
    )
  }
}
