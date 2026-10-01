// fallow-ignore-file code-duplication

// Portal context — Drizzle schema for the per-language text of Portal content.
// Split from portal.schema.ts (round 4) so the localized working model has a
// home that does not grow the Portal core file. snake_case columns, camelCase
// field names.

import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { GUEST_LOCALE_SQL_LIST } from '../../guest-locale-schemas'
import { portalLinks, portals } from './portal.schema'

// ── portal_link_texts ──────────────────────────────────────────────
// One row per link and language: the label a guest reads on the tile and an
// optional line under it. A link's wording lives here and only here: the link
// row's legacy `label` is never written, and readers fall back to it only for a
// link with no primary-language row (one written before this table existed).

export const portalLinkTexts = pgTable(
  'portal_link_texts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    linkId: uuid('link_id').notNull(),
    locale: varchar('locale', { length: 35 }).notNull(),
    label: varchar('label', { length: 100 }).notNull(),
    line: varchar('line', { length: 160 }),
    // Null for text a manager wrote. `ai_draft` is reserved for a later,
    // separately released capability; nothing writes it yet.
    provenance: varchar('provenance', { length: 20 }),
    version: integer('version').notNull().default(1),
    updatedBy: varchar('updated_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('portal_link_texts_link_locale_unique').on(
      t.organizationId,
      t.linkId,
      t.locale,
    ),
    index('portal_link_texts_portal_idx').on(t.organizationId, t.portalId),
    foreignKey({
      name: 'portal_link_texts_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'portal_link_texts_link_tenant_fk',
      columns: [t.organizationId, t.portalId, t.linkId],
      foreignColumns: [portalLinks.organizationId, portalLinks.portalId, portalLinks.id],
    }).onDelete('cascade'),
    check(
      'portal_link_texts_locale_active',
      sql`${t.locale} IN (${sql.raw(GUEST_LOCALE_SQL_LIST)})`,
    ),
    check('portal_link_texts_label_present', sql`length(btrim(${t.label})) > 0`),
    check(
      'portal_link_texts_line_present',
      sql`${t.line} IS NULL OR length(btrim(${t.line})) > 0`,
    ),
    check(
      'portal_link_texts_provenance_valid',
      sql`${t.provenance} IS NULL OR ${t.provenance} = 'ai_draft'`,
    ),
    check('portal_link_texts_version_positive', sql`${t.version} >= 1`),
  ],
)
