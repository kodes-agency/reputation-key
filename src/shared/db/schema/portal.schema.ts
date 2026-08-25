// Portal context — Drizzle schema for portals, portal_link_categories, portal_links tables
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import { createdAtColumn, updatedAtColumn, deletedAtColumn } from '../columns'
import { portalGroups } from './portal-group.schema'
import { properties } from './property.schema'
export { portalGroups } from './portal-group.schema'
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  integer,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core'

// ── portals ────────────────────────────────────────────────────────

export const portals = pgTable(
  'portals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    entityType: varchar('entity_type', { length: 20 }).notNull().default('property'),
    entityId: varchar('entity_id', { length: 255 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    description: varchar('description', { length: 500 }),
    heroImageUrl: varchar('hero_image_url', { length: 500 }),
    theme: jsonb('theme').default({}),
    privateFeedbackThreshold: integer('private_feedback_threshold').notNull().default(3),
    publicationState: varchar('publication_state', { length: 20 })
      .notNull()
      .default('draft'),
    // Immutable provenance. Existing pre-expand rows remain null rather than
    // guessing ownership from access grants or legacy Team data.
    createdBy: varchar('created_by', { length: 255 }),
    responsibleManagerRevision: integer('responsible_manager_revision')
      .notNull()
      .default(1),
    responsibilityNeededSince: timestamp('responsibility_needed_since', {
      withTimezone: true,
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t) => ({
    orgPropertySlugUnique: uniqueIndex('portals_org_property_slug_unique')
      .on(t.organizationId, t.propertyId, t.slug)
      .where(sql`deleted_at IS NULL`),
    orgPropertyIdx: index('portals_org_property_idx').on(t.organizationId, t.propertyId),
    orgIdKey: uniqueIndex('portals_org_id_key').on(t.organizationId, t.id),
    orgPropertyIdKey: uniqueIndex('portals_org_property_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    propertyTenantFk: foreignKey({
      name: 'portals_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    publicationStateCheck: check(
      'portals_publication_state_valid',
      sql`${t.publicationState} IN ('draft', 'published', 'disabled', 'archived')`,
    ),
    privateFeedbackThresholdCheck: check(
      'portals_private_feedback_threshold_valid',
      sql`${t.privateFeedbackThreshold} BETWEEN 1 AND 5`,
    ),
    responsibleManagerRevisionCheck: check(
      'portals_responsible_manager_revision_positive',
      sql`${t.responsibleManagerRevision} >= 1`,
    ),
  }),
)

// ── portal_responsible_managers ───────────────────────────────────

export const portalResponsibleManagers = pgTable(
  'portal_responsible_managers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    endReason: varchar('end_reason', { length: 500 }),
  },
  (t) => ({
    orgPortalIdx: index('prm_org_portal_idx').on(t.organizationId, t.portalId),
    orgUserIdx: index('prm_org_user_idx').on(t.organizationId, t.userId),
    uniqueActiveManager: uniqueIndex('prm_unique_active_manager')
      .on(t.organizationId, t.portalId, t.userId)
      .where(sql`effective_to IS NULL`),
    portalTenantFk: foreignKey({
      name: 'prm_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    intervalCheck: check(
      'prm_interval_valid',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  }),
)

// ── portal_tokens ─────────────────────────────────────────────────

export const portalTokens = pgTable(
  'portal_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    tokenIdentifier: varchar('token_identifier', { length: 24 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    tokenKeyVersion: integer('token_key_version').notNull().default(1),
    version: integer('version').notNull(),
    printBatch: varchar('print_batch', { length: 100 }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    gracePeriodEnds: timestamp('grace_period_ends', { withTimezone: true }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: varchar('revoked_by', { length: 255 }),
    revokedReason: varchar('revoked_reason', { length: 500 }),
    createdAt: createdAtColumn(),
  },
  (t) => ({
    identifierUnique: uniqueIndex('portal_tokens_identifier_unique').on(
      t.tokenIdentifier,
    ),
    tokenHashUnique: uniqueIndex('portal_tokens_hash_unique').on(t.tokenHash),
    portalVersionUnique: uniqueIndex('portal_tokens_portal_version_unique').on(
      t.organizationId,
      t.portalId,
      t.version,
    ),
    activeLookupIdx: index('portal_tokens_active_lookup_idx').on(
      t.tokenIdentifier,
      t.status,
      t.gracePeriodEnds,
    ),
    portalTenantFk: foreignKey({
      name: 'portal_tokens_portal_tenant_fk',
      columns: [t.organizationId, t.portalId],
      foreignColumns: [portals.organizationId, portals.id],
    }).onDelete('cascade'),
    propertyTenantFk: foreignKey({
      name: 'portal_tokens_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    statusCheck: check(
      'portal_tokens_status_valid',
      sql`${t.status} IN ('active', 'rotating', 'revoked')`,
    ),
  }),
)

// ── portal_link_categories ─────────────────────────────────────────

export const portalLinkCategories = pgTable(
  'portal_link_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    title: varchar('title', { length: 100 }).notNull(),
    sortKey: varchar('sort_key', { length: 50 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => ({
    portalIdx: index('portal_link_categories_portal_idx').on(t.portalId),
    orgPortalIdKey: uniqueIndex('portal_link_categories_org_portal_id_key').on(
      t.organizationId,
      t.portalId,
      t.id,
    ),
    portalTenantFk: foreignKey({
      name: 'portal_link_categories_portal_tenant_fk',
      columns: [t.organizationId, t.portalId],
      foreignColumns: [portals.organizationId, portals.id],
    }).onDelete('cascade'),
  }),
)

// ── portal_links ───────────────────────────────────────────────────

export const portalLinks = pgTable(
  'portal_links',
  {
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
  },
  (t) => ({
    portalIdx: index('portal_links_portal_idx').on(t.portalId),
    categoryIdx: index('portal_links_category_idx').on(t.categoryId),
    orgPortalIdKey: uniqueIndex('portal_links_org_portal_id_key').on(
      t.organizationId,
      t.portalId,
      t.id,
    ),
    categoryTenantFk: foreignKey({
      name: 'portal_links_category_tenant_fk',
      columns: [t.organizationId, t.portalId, t.categoryId],
      foreignColumns: [
        portalLinkCategories.organizationId,
        portalLinkCategories.portalId,
        portalLinkCategories.id,
      ],
    }).onDelete('cascade'),
    portalTenantFk: foreignKey({
      name: 'portal_links_portal_tenant_fk',
      columns: [t.organizationId, t.portalId],
      foreignColumns: [portals.organizationId, portals.id],
    }).onDelete('cascade'),
  }),
)

// ── portal_group_members ──────────────────────────────────────────
// portalGroups table is defined in portal-group.schema.ts

export const portalGroupMembers = pgTable(
  'portal_group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portalGroupId: uuid('portal_group_id')
      .notNull()
      .references(() => portalGroups.id, { onDelete: 'cascade' }),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => ({
    portalIdUnique: uniqueIndex('portal_group_members_portal_id_unique').on(t.portalId),
    groupIdx: index('portal_group_members_group_idx').on(t.portalGroupId),
  }),
)
