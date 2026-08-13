import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { properties } from './property.schema'

/**
 * Content-free receipt for a Property mutation committed on behalf of an
 * Integration import item. Provider identifiers and display fields never enter
 * this table. The destination FK is nullable so deletion can retain a bounded
 * tombstone after clearing the live Property reference.
 */
export const propertyOperationReceipts = pgTable(
  'property_operation_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    destinationPropertyId: uuid('destination_property_id'),
    outcome: varchar('outcome', { length: 32 }).notNull(),
    destinationSourceEpoch: integer('destination_source_epoch').notNull(),
    destinationProfileVersion: integer('destination_profile_version').notNull(),
    tombstone: boolean('tombstone').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    retentionReleasedAt: timestamp('retention_released_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => ({
    organizationIdempotencyUnique: uniqueIndex(
      'property_operation_receipts_org_idempotency_unique',
    ).on(t.organizationId, t.idempotencyKey),
    destinationTenantFk: foreignKey({
      name: 'property_operation_receipts_destination_tenant_fk',
      columns: [t.organizationId, t.destinationPropertyId],
      foreignColumns: [properties.organizationId, properties.id],
    })
      .onDelete('restrict')
      .onUpdate('no action'),
    releasableExpiryIdx: index('property_operation_receipts_releasable_expiry_idx')
      .on(t.expiresAt, t.id)
      .where(sql`${t.retentionReleasedAt} IS NOT NULL`),
    unreleasedExpiryIdx: index('property_operation_receipts_unreleased_expiry_idx')
      .on(t.expiresAt, t.id)
      .where(sql`${t.retentionReleasedAt} IS NULL`),
    outcomeCheck: check(
      'property_operation_receipts_outcome_valid',
      sql`${t.outcome} IN ('imported', 'relinked', 'property_deleted')`,
    ),
    destinationCheck: check(
      'property_operation_receipts_destination_valid',
      sql`(
        (${t.tombstone} = false AND ${t.outcome} IN ('imported', 'relinked') AND ${t.destinationPropertyId} IS NOT NULL)
        OR (${t.tombstone} = true AND ${t.outcome} = 'property_deleted' AND ${t.destinationPropertyId} IS NULL)
      )`,
    ),
    generationsCheck: check(
      'property_operation_receipts_generations_valid',
      sql`${t.destinationSourceEpoch} >= 0 AND ${t.destinationProfileVersion} >= 1`,
    ),
    expiryCheck: check(
      'property_operation_receipts_expiry_valid',
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
    releaseCheck: check(
      'property_operation_receipts_release_valid',
      sql`${t.retentionReleasedAt} IS NULL OR ${t.retentionReleasedAt} >= ${t.createdAt}`,
    ),
  }),
)
