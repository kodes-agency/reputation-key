// Portal context — Drizzle schema for the uploaded images of the guest page.
// Split from portal.schema.ts (round 4) so media has a home that does not grow
// the Portal core file. snake_case columns, camelCase field names.
//
// One row per stored image: the manager's upload after it has been decoded and
// re-encoded, never the upload itself. A publication snapshot refers to an
// asset by id only, with no foreign key, so a takedown (`status = 'taken_down'`)
// can stop an image being served without rewriting an immutable snapshot. The
// working model refers to it through the foreign keys on the Brand Profile and
// on the link, which the database ties to an asset of the same Property.

import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn } from '../columns'
import {
  PORTAL_MEDIA_PURPOSE_SQL_LIST,
  PORTAL_MEDIA_SOURCE_FORMAT_SQL_LIST,
  PORTAL_MEDIA_STATUS_SQL_LIST,
} from '../../portal-media-schemas'
import { properties } from './property.schema'

export const portalMediaAssets = pgTable(
  'portal_media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    purpose: varchar('purpose', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    // portal-media/<id>.webp in the private object store; served same-origin.
    objectKey: varchar('object_key', { length: 120 }).notNull(),
    contentType: varchar('content_type', { length: 32 }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    byteSize: integer('byte_size').notNull(),
    // Of the stored (re-encoded) bytes, so a swapped object is detectable.
    contentSha256: varchar('content_sha256', { length: 64 }).notNull(),
    // What the upload was, kept for diagnosis; its bytes are not kept.
    sourceFormat: varchar('source_format', { length: 8 }).notNull(),
    sourceBytes: integer('source_bytes').notNull(),
    // When the uploader confirmed they hold the rights to the image.
    rightsConfirmedAt: timestamp('rights_confirmed_at', { withTimezone: true }).notNull(),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    takenDownAt: timestamp('taken_down_at', { withTimezone: true }),
  },
  (t) => [
    // The foreign-key target of every reference to an asset, and the index the
    // per-Property lookups use (it leads with organization and Property).
    uniqueIndex('portal_media_assets_org_property_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    uniqueIndex('portal_media_assets_object_key_unique').on(t.objectKey),
    foreignKey({
      name: 'portal_media_assets_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    check(
      'portal_media_assets_purpose_valid',
      sql`${t.purpose} IN (${sql.raw(PORTAL_MEDIA_PURPOSE_SQL_LIST)})`,
    ),
    check(
      'portal_media_assets_status_valid',
      sql`${t.status} IN (${sql.raw(PORTAL_MEDIA_STATUS_SQL_LIST)})`,
    ),
    check(
      'portal_media_assets_takedown_consistent',
      sql`(${t.status} = 'taken_down') = (${t.takenDownAt} IS NOT NULL)`,
    ),
    check(
      'portal_media_assets_object_key_derived',
      sql`${t.objectKey} = 'portal-media/' || ${t.id}::text || '.webp'`,
    ),
    check('portal_media_assets_content_type_webp', sql`${t.contentType} = 'image/webp'`),
    check(
      'portal_media_assets_dimensions_valid',
      sql`${t.width} BETWEEN 1 AND 16384 AND ${t.height} BETWEEN 1 AND 16384`,
    ),
    check('portal_media_assets_byte_size_positive', sql`${t.byteSize} >= 1`),
    check('portal_media_assets_sha256_valid', sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'portal_media_assets_source_format_valid',
      sql`${t.sourceFormat} IN (${sql.raw(PORTAL_MEDIA_SOURCE_FORMAT_SQL_LIST)})`,
    ),
    check('portal_media_assets_source_bytes_positive', sql`${t.sourceBytes} >= 1`),
  ],
)
