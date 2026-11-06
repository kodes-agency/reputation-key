// Property context — row ↔ domain mapper
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { properties } from '#/shared/db/schema/property.schema'
import type {
  PropertyGoogleBindingInternalView,
  PropertyGoogleBindingSummary,
} from '../../application/ports/property-google-binding.port'
import type { Property } from '../../domain/types'
import type { PropertyLifecycleState } from '../../domain/property-lifecycle'
import { unbrand } from '#/shared/domain/ids'
import { propertyId, organizationId, googleConnectionId } from '#/shared/domain/ids'

type PropertyRow = Omit<
  typeof properties.$inferSelect,
  | 'defaultReplyLanguage'
  | 'responsibleManagerRevision'
  | 'responsibilityNeededSince'
  | 'googleReviewUri'
  | 'googleReviewDestinationState'
  | 'googleReviewDestinationRetrievedAt'
  | 'googleReviewDestinationSourceEpoch'
  | 'googleReviewDestinationProfileVersion'
  | 'googlePrimaryCategory'
  | 'googlePrimaryCategoryUpdatedAt'
> &
  Readonly<{
    defaultReplyLanguage?: string | null
    /** Optional only for pre-expand fixtures. */
    responsibleManagerRevision?: number
    responsibilityNeededSince?: Date | null
    googleReviewUri?: string | null
    googleReviewDestinationState?: string
    googleReviewDestinationRetrievedAt?: Date | null
    googleReviewDestinationSourceEpoch?: number | null
    googleReviewDestinationProfileVersion?: number | null
    googlePrimaryCategory?: string | null
    googlePrimaryCategoryUpdatedAt?: Date | null
  }>
type PropertyInsertRow = typeof properties.$inferInsert

export const propertyFromRow = (row: PropertyRow): Property => ({
  id: propertyId(row.id),
  organizationId: organizationId(row.organizationId),
  name: row.name,
  slug: row.slug,
  timezone: row.timezone,
  defaultReplyLanguage: row.defaultReplyLanguage ?? null,
  address: row.address ?? null,
  gbpLocationId: row.gbpLocationId,
  gbpAccountId: row.gbpAccountId ?? null,
  googleConnectionId: row.googleConnectionId
    ? googleConnectionId(row.googleConnectionId)
    : null,
  profileVersion: row.profileVersion,
  googleBindingState: row.googleBindingState as Property['googleBindingState'],
  googleReviewDestination: {
    state: (row.googleReviewDestinationState ?? 'unavailable') as NonNullable<
      Property['googleReviewDestination']
    >['state'],
    uri: row.googleReviewUri ?? null,
    retrievedAt: row.googleReviewDestinationRetrievedAt ?? null,
    sourceEpoch: row.googleReviewDestinationSourceEpoch ?? null,
    profileVersion: row.googleReviewDestinationProfileVersion ?? null,
  },
  googlePrimaryCategory: row.googlePrimaryCategory ?? null,
  googlePrimaryCategoryUpdatedAt: row.googlePrimaryCategoryUpdatedAt ?? null,
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
  sourceEpoch: row.sourceEpoch ?? 0,
  responsibleManagerRevision: row.responsibleManagerRevision ?? 1,
  responsibilityNeededSince: row.responsibilityNeededSince ?? null,
})

export const propertyToRow = (property: Property): PropertyInsertRow => ({
  id: unbrand(property.id),
  organizationId: unbrand(property.organizationId),
  name: property.name,
  slug: property.slug,
  timezone: property.timezone,
  defaultReplyLanguage: property.defaultReplyLanguage ?? null,
  address: property.address,
  gbpLocationId: property.gbpLocationId,
  gbpAccountId: property.gbpAccountId,
  googleConnectionId:
    property.googleConnectionId != null ? unbrand(property.googleConnectionId) : null,
  profileVersion: property.profileVersion,
  googleBindingState: property.googleBindingState,
  googleReviewUri: property.googleReviewDestination?.uri ?? null,
  googleReviewDestinationState: property.googleReviewDestination?.state ?? 'unavailable',
  googleReviewDestinationRetrievedAt:
    property.googleReviewDestination?.retrievedAt ?? null,
  googleReviewDestinationSourceEpoch:
    property.googleReviewDestination?.sourceEpoch ?? null,
  googleReviewDestinationProfileVersion:
    property.googleReviewDestination?.profileVersion ?? null,
  googlePrimaryCategory: property.googlePrimaryCategory ?? null,
  googlePrimaryCategoryUpdatedAt: property.googlePrimaryCategoryUpdatedAt ?? null,
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
  sourceEpoch: property.sourceEpoch,
  responsibleManagerRevision: property.responsibleManagerRevision,
  responsibilityNeededSince: property.responsibilityNeededSince,
})

export function summaryFromRow(
  row: typeof properties.$inferSelect,
): PropertyGoogleBindingSummary {
  return {
    state: row.googleBindingState as PropertyGoogleBindingSummary['state'],
    sourceEpoch: row.sourceEpoch,
    profileVersion: row.profileVersion,
    profileSource: row.profileSource as PropertyGoogleBindingSummary['profileSource'],
    profileConfirmedAt: row.profileConfirmedAt,
  }
}

export function internalFromRow(
  row: typeof properties.$inferSelect,
): PropertyGoogleBindingInternalView {
  return {
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.id),
    state: row.googleBindingState as PropertyGoogleBindingInternalView['state'],
    connectionId: row.googleConnectionId
      ? googleConnectionId(row.googleConnectionId)
      : null,
    accountId: row.gbpAccountId,
    locationId: row.gbpLocationId,
    sourceEpoch: row.sourceEpoch,
    profileVersion: row.profileVersion,
    profileSource:
      row.profileSource as PropertyGoogleBindingInternalView['profileSource'],
    profileConfirmedAt: row.profileConfirmedAt,
    deletedAt: row.deletedAt,
    name: row.name,
    address: row.address,
    countryCode: row.countryCode,
    timezone: row.timezone,
    lifecycleState: row.lifecycleState,
    googleReviewDestination: {
      state:
        row.googleReviewDestinationState as PropertyGoogleBindingInternalView['googleReviewDestination']['state'],
      uri: row.googleReviewUri,
      retrievedAt: row.googleReviewDestinationRetrievedAt,
      sourceEpoch: row.googleReviewDestinationSourceEpoch,
      profileVersion: row.googleReviewDestinationProfileVersion,
    },
  }
}
