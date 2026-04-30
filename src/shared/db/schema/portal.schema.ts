// Portal context — Drizzle schema for portals, portal_link_categories, portal_links tables
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import { createdAtColumn, updatedAtColumn, deletedAtColumn } from '../columns'
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  smallint,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// ── portals ────────────────────────────────────────────────────────

export const portals = pgTable(
  'portals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    entityType: varchar('entity_type', { length: 20 }).notNull().default('property'),
    entityId: varchar('entity_id', { length: 255 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    description: varchar('description', { length: 500 }),
    heroImageUrl: varchar('hero_image_url', { length: 500 }),
    theme: jsonb('theme').default({}),
    smartRoutingEnabled: boolean('smart_routing_enabled').notNull().default(false),
    smartRoutingThreshold: smallint('smart_routing_threshold').notNull().default(4),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t) => ({
    orgSlugUnique: uniqueIndex('portals_org_slug_unique')
      .on(t.organizationId, t.slug)
      .where(sql`deleted_at IS NULL`),
    orgPropertyIdx: index('portals_org_property_idx').on(t.organizationId, t.propertyId),
  }),
)

// ── portal_link_categories ─────────────────────────────────────────

export const portalLinkCategories = pgTable('portal_link_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id')
    .notNull()
    .references(() => portals.id, { onDelete: 'cascade' }),
  organizationId: varchar('organization_id', { length: 255 }).notNull(),
  title: varchar('title', { length: 100 }).notNull(),
  sortKey: varchar('sort_key', { length: 50 }).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
})

// ── portal_links ───────────────────────────────────────────────────

export const portalLinks = pgTable('portal_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => portalLinkCategories.id, { onDelete: 'cascade' }),
  portalId: uuid('portal_id')
    .notNull()
    .references(() => portals.id, { onDelete: 'cascade' }),
  organizationId: varchar('organization_id', { length: 255 }).notNull(),
  label: varchar('label', { length: 100 }).notNull(),
  url: varchar('url', { length: 500 }).notNull(),
  iconKey: varchar('icon_key', { length: 50 }),
  sortKey: varchar('sort_key', { length: 50 }).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
})
