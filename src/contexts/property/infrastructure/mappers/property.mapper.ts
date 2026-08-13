// Property context — row ↔ domain mapper
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { properties } from '#/shared/db/schema/property.schema'
import type { Property } from '../../domain/types'
import type { PropertyLifecycleState } from '../../domain/property-lifecycle'
import { unbrand } from '#/shared/domain/ids'
import { propertyId, organizationId, googleConnectionId } from '#/shared/domain/ids'

type PropertyRow = typeof properties.$inferSelect
type PropertyInsertRow = typeof properties.$inferInsert

export const propertyFromRow = (row: PropertyRow): Property => ({
  id: propertyId(row.id),
  organizationId: organizationId(row.organizationId),
  name: row.name,
  slug: row.slug,
  timezone: row.timezone,
  address: row.address ?? null,
  gbpLocationId: row.gbpLocationId,
  gbpAccountId: row.gbpAccountId ?? null,
  googleConnectionId: row.googleConnectionId
    ? googleConnectionId(row.googleConnectionId)
    : null,
  profileVersion: row.profileVersion,
  googleBindingState: row.googleBindingState as Property['googleBindingState'],
  profileSource: row.profileSource as Property['profileSource'],
  profileConfirmedAt: row.profileConfirmedAt,
  profileConfirmedBy: row.profileConfirmedBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
  lifecycleState: row.lifecycleState as PropertyLifecycleState,
  lifecycleReason: row.lifecycleReason,
  lifecycleStateChangedAt: row.lifecycleStateChangedAt,
  purgeScheduledFor: row.purgeScheduledFor,
  lifecycleInitiatedBy: row.lifecycleInitiatedBy,
  countryCode: row.countryCode ?? null,
  countrySource: row.countrySource ?? null,
  timezoneSource: row.timezoneSource ?? null,
  timezoneResolvedAt: row.timezoneResolvedAt ?? null,
  processingRegion: row.processingRegion ?? null,
  processingRegionSource: row.processingRegionSource ?? null,
  routingPolicyVersion: row.routingPolicyVersion ?? 1,
  processingRegionResolvedAt: row.processingRegionResolvedAt ?? null,
  sourceEpoch: row.sourceEpoch ?? 0,
})

export const propertyToRow = (property: Property): PropertyInsertRow => ({
  id: unbrand(property.id),
  organizationId: unbrand(property.organizationId),
  name: property.name,
  slug: property.slug,
  timezone: property.timezone,
  address: property.address,
  gbpLocationId: property.gbpLocationId,
  gbpAccountId: property.gbpAccountId,
  googleConnectionId:
    property.googleConnectionId != null ? unbrand(property.googleConnectionId) : null,
  profileVersion: property.profileVersion,
  googleBindingState: property.googleBindingState,
  profileSource: property.profileSource,
  profileConfirmedAt: property.profileConfirmedAt,
  profileConfirmedBy: property.profileConfirmedBy,
  createdAt: property.createdAt,
  updatedAt: property.updatedAt,
  deletedAt: property.deletedAt,
  lifecycleState: property.lifecycleState,
  lifecycleReason: property.lifecycleReason,
  lifecycleStateChangedAt: property.lifecycleStateChangedAt,
  purgeScheduledFor: property.purgeScheduledFor,
  lifecycleInitiatedBy: property.lifecycleInitiatedBy,
  countryCode: property.countryCode,
  countrySource: property.countrySource,
  timezoneSource: property.timezoneSource,
  timezoneResolvedAt: property.timezoneResolvedAt,
  processingRegion: property.processingRegion,
  processingRegionSource: property.processingRegionSource,
  routingPolicyVersion: property.routingPolicyVersion,
  processingRegionResolvedAt: property.processingRegionResolvedAt,
  sourceEpoch: property.sourceEpoch,
})
