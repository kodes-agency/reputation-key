// Property context — row ↔ domain mapper
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { properties } from '#/shared/db/schema/property.schema'
import type {
  PropertyGoogleBindingInternalView,
  PropertyGoogleBindingSummary,
} from '../../application/ports/property-google-binding.port'
import type { Property } from '../../domain/types'
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

type PropertyColumns = Partial<PropertyInsertRow>
type ColumnKey = keyof Property & keyof PropertyRow & keyof PropertyInsertRow

type PropertyField<K extends keyof Property> = Readonly<{
  fromRow: (row: PropertyRow) => Property[K]
  toColumns: (value: Property[K]) => PropertyColumns
  /** A patch may set it; identity, lifecycle and destination columns never are. */
  settable: boolean
}>

// A column named like the field. The row types narrow some strings to unions
// the column type does not carry, hence the casts.
const column = <K extends ColumnKey>(key: K, settable: boolean): PropertyField<K> => ({
  fromRow: (row) => row[key] as unknown as Property[K],
  toColumns: (value) => ({ [key]: value }),
  settable,
})

// A nullable column whose row may predate it: absent reads as null.
const nullableColumn = <K extends ColumnKey>(
  key: K,
  settable: boolean,
): PropertyField<K> => ({
  fromRow: (row) => (row[key] ?? null) as Property[K],
  toColumns: (value) => ({ [key]: value ?? null }),
  settable,
})

// A column with a default for rows written before it existed.
const defaultedColumn = <K extends ColumnKey>(
  key: K,
  fallback: Property[K],
  settable: boolean,
): PropertyField<K> => ({
  fromRow: (row) => (row[key] ?? fallback) as Property[K],
  toColumns: (value) => ({ [key]: value }),
  settable,
})

const destinationField: PropertyField<'googleReviewDestination'> = {
  fromRow: (row) => ({
    state: (row.googleReviewDestinationState ?? 'unavailable') as NonNullable<
      Property['googleReviewDestination']
    >['state'],
    uri: row.googleReviewUri ?? null,
    retrievedAt: row.googleReviewDestinationRetrievedAt ?? null,
    sourceEpoch: row.googleReviewDestinationSourceEpoch ?? null,
    profileVersion: row.googleReviewDestinationProfileVersion ?? null,
  }),
  toColumns: (destination) => ({
    googleReviewUri: destination?.uri ?? null,
    googleReviewDestinationState: destination?.state ?? 'unavailable',
    googleReviewDestinationRetrievedAt: destination?.retrievedAt ?? null,
    googleReviewDestinationSourceEpoch: destination?.sourceEpoch ?? null,
    googleReviewDestinationProfileVersion: destination?.profileVersion ?? null,
  }),
  settable: false,
}

/**
 * The one list of a Property's fields. Row reading, row writing and the
 * columns a patch may set all derive from it, and the mapped type makes a
 * field added to `Property` fail to compile until it is listed here.
 */
const PROPERTY_FIELDS: { readonly [K in keyof Required<Property>]: PropertyField<K> } = {
  id: {
    fromRow: (row) => propertyId(row.id),
    toColumns: (value) => ({ id: unbrand(value) }),
    settable: false,
  },
  organizationId: {
    fromRow: (row) => organizationId(row.organizationId),
    toColumns: (value) => ({ organizationId: unbrand(value) }),
    settable: false,
  },
  name: column('name', true),
  slug: column('slug', true),
  timezone: column('timezone', true),
  defaultReplyLanguage: nullableColumn('defaultReplyLanguage', true),
  address: nullableColumn('address', true),
  gbpLocationId: column('gbpLocationId', true),
  gbpAccountId: nullableColumn('gbpAccountId', true),
  googleConnectionId: {
    fromRow: (row) =>
      row.googleConnectionId ? googleConnectionId(row.googleConnectionId) : null,
    toColumns: (value) => ({ googleConnectionId: value != null ? unbrand(value) : null }),
    settable: true,
  },
  profileVersion: column('profileVersion', true),
  googleBindingState: column('googleBindingState', true),
  googleReviewDestination: destinationField,
  googlePrimaryCategory: nullableColumn('googlePrimaryCategory', false),
  googlePrimaryCategoryUpdatedAt: nullableColumn('googlePrimaryCategoryUpdatedAt', false),
  profileSource: column('profileSource', true),
  profileConfirmedAt: column('profileConfirmedAt', true),
  profileConfirmedBy: column('profileConfirmedBy', true),
  createdAt: column('createdAt', false),
  updatedAt: column('updatedAt', true),
  deletedAt: column('deletedAt', false),
  lifecycleState: column('lifecycleState', false),
  lifecycleReason: column('lifecycleReason', false),
  lifecycleStateChangedAt: column('lifecycleStateChangedAt', false),
  purgeScheduledFor: column('purgeScheduledFor', false),
  lifecycleInitiatedBy: column('lifecycleInitiatedBy', false),
  countryCode: nullableColumn('countryCode', true),
  countrySource: nullableColumn('countrySource', true),
  timezoneSource: nullableColumn('timezoneSource', true),
  timezoneResolvedAt: nullableColumn('timezoneResolvedAt', true),
  sourceEpoch: defaultedColumn('sourceEpoch', 0, true),
  responsibleManagerRevision: defaultedColumn('responsibleManagerRevision', 1, false),
  responsibilityNeededSince: nullableColumn('responsibilityNeededSince', false),
}

// Each field's value is typed by its own key; the loops below walk them untyped.
type AnyField = PropertyField<keyof Property>
const fieldEntries = Object.entries(PROPERTY_FIELDS) as Array<[keyof Property, AnyField]>

export const propertyFromRow = (row: PropertyRow): Property =>
  Object.fromEntries(
    fieldEntries.map(([key, field]) => [key, field.fromRow(row)]),
  ) as Property

export const propertyToRow = (property: Property): PropertyInsertRow =>
  Object.assign(
    {},
    ...fieldEntries.map(([key, field]) => field.toColumns(property[key])),
  ) as PropertyInsertRow

/** The columns a patch sets; never identity, lifecycle or destination columns. */
export const buildPropertySetClause = (
  patch: Readonly<Partial<Property>>,
): PropertyColumns =>
  Object.assign(
    {},
    ...fieldEntries
      .filter(([key, field]) => field.settable && patch[key] !== undefined)
      .map(([key, field]) => field.toColumns(patch[key])),
  )

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
