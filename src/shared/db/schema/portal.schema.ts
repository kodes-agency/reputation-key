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
  (t) => [
    uniqueIndex('portals_org_property_slug_unique')
      .on(t.organizationId, t.propertyId, t.slug)
      .where(sql`deleted_at IS NULL`),
    index('portals_org_property_idx').on(t.organizationId, t.propertyId),
    uniqueIndex('portals_org_id_key').on(t.organizationId, t.id),
    uniqueIndex('portals_org_property_id_key').on(t.organizationId, t.propertyId, t.id),
    foreignKey({
      name: 'portals_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    check(
      'portals_publication_state_valid',
      sql`${t.publicationState} IN ('draft', 'published', 'disabled', 'archived')`,
    ),
    check(
      'portals_private_feedback_threshold_valid',
      sql`${t.privateFeedbackThreshold} BETWEEN 1 AND 5`,
    ),
    check(
      'portals_responsible_manager_revision_positive',
      sql`${t.responsibleManagerRevision} >= 1`,
    ),
  ],
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
  (t) => [
    index('prm_org_portal_idx').on(t.organizationId, t.portalId),
    index('prm_org_user_idx').on(t.organizationId, t.userId),
    uniqueIndex('prm_unique_active_manager')
      .on(t.organizationId, t.portalId, t.userId)
      .where(sql`effective_to IS NULL`),
    foreignKey({
      name: 'prm_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    check(
      'prm_interval_valid',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
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
  (t) => [
    uniqueIndex('portal_tokens_identifier_unique').on(t.tokenIdentifier),
    uniqueIndex('portal_tokens_hash_unique').on(t.tokenHash),
    uniqueIndex('portal_tokens_portal_version_unique').on(
      t.organizationId,
      t.portalId,
      t.version,
    ),
    index('portal_tokens_active_lookup_idx').on(
      t.tokenIdentifier,
      t.status,
      t.gracePeriodEnds,
    ),
    foreignKey({
      name: 'portal_tokens_portal_tenant_fk',
      columns: [t.organizationId, t.portalId],
      foreignColumns: [portals.organizationId, portals.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'portal_tokens_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    check(
      'portal_tokens_status_valid',
      sql`${t.status} IN ('active', 'rotating', 'revoked')`,
    ),
  ],
)

// ── immutable Portal publication snapshots ───────────────────────

/**
 * The exact public experience approved by a manager. Working Portal/link rows
 * can continue changing without mutating what an already-published address
 * resolves. A later publication inserts a new version; rollback points a new
 * activation at an older row rather than rewriting either snapshot.
 */
export const portalPublicationSnapshots = pgTable(
  'portal_publication_snapshots',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    version: integer('version').notNull(),
    configurationDigest: varchar('configuration_digest', { length: 64 }).notNull(),
    configuration: jsonb('configuration').notNull(),
    guestLocale: varchar('guest_locale', { length: 35 }).notNull(),
    languagePackVersion: varchar('language_pack_version', { length: 100 }).notNull(),
    privateFeedbackThreshold: integer('private_feedback_threshold').notNull(),
    destinationUri: varchar('destination_uri', { length: 500 }).notNull(),
    destinationRetrievedAt: timestamp('destination_retrieved_at', {
      withTimezone: true,
    }).notNull(),
    destinationSourceEpoch: integer('destination_source_epoch').notNull(),
    destinationProfileVersion: integer('destination_profile_version').notNull(),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('portal_publication_snapshots_portal_version_unique').on(
      t.organizationId,
      t.portalId,
      t.version,
    ),
    uniqueIndex('portal_publication_snapshots_tenant_scope_id_key').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.id,
    ),
    uniqueIndex('portal_publication_snapshots_evidence_binding_key').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.id,
      t.version,
      t.configurationDigest,
    ),
    index('portal_publication_snapshots_portal_created_idx').on(
      t.organizationId,
      t.portalId,
      t.createdAt,
    ),
    foreignKey({
      name: 'portal_publication_snapshots_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    check('portal_publication_snapshots_version_positive', sql`${t.version} >= 1`),
    check(
      'portal_publication_snapshots_digest_valid',
      sql`${t.configurationDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'portal_publication_snapshots_configuration_object',
      sql`jsonb_typeof(${t.configuration}) = 'object'`,
    ),
    check('portal_publication_snapshots_locale_valid', sql`${t.guestLocale} = 'en'`),
    check(
      'portal_publication_snapshots_language_pack_valid',
      sql`${t.languagePackVersion} = 'guest-ui-en-v1'`,
    ),
    check(
      'portal_publication_snapshots_threshold_valid',
      sql`${t.privateFeedbackThreshold} BETWEEN 1 AND 5`,
    ),
    check(
      'portal_publication_snapshots_destination_binding_valid',
      sql`${t.destinationUri} ~~ 'https://%' AND ${t.destinationSourceEpoch} >= 0 AND ${t.destinationProfileVersion} >= 1`,
    ),
  ],
)

/**
 * Effective-dated routing history from one stable Portal address to one exact
 * immutable snapshot. Only one interval can be open for a Portal. Rollback is
 * an additional activation row, so the complete publication history survives.
 */
export const portalPublicationActivations = pgTable(
  'portal_publication_activations',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    snapshotId: uuid('snapshot_id').notNull(),
    activationSequence: integer('activation_sequence').notNull(),
    kind: varchar('kind', { length: 20 }).notNull(),
    activatedBy: varchar('activated_by', { length: 255 }).notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    deactivationReason: varchar('deactivation_reason', { length: 20 }),
  },
  (t) => [
    uniqueIndex('portal_publication_activations_portal_sequence_unique').on(
      t.organizationId,
      t.portalId,
      t.activationSequence,
    ),
    uniqueIndex('portal_publication_activations_one_current_per_portal')
      .on(t.organizationId, t.portalId)
      .where(sql`${t.deactivatedAt} IS NULL`),
    index('portal_publication_activations_snapshot_idx').on(
      t.organizationId,
      t.portalId,
      t.snapshotId,
    ),
    foreignKey({
      name: 'portal_publication_activations_snapshot_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId, t.snapshotId],
      foreignColumns: [
        portalPublicationSnapshots.organizationId,
        portalPublicationSnapshots.propertyId,
        portalPublicationSnapshots.portalId,
        portalPublicationSnapshots.id,
      ],
    }).onDelete('restrict'),
    check(
      'portal_publication_activations_sequence_positive',
      sql`${t.activationSequence} >= 1`,
    ),
    check(
      'portal_publication_activations_kind_valid',
      sql`${t.kind} IN ('publish', 'rollback')`,
    ),
    check(
      'portal_publication_activations_interval_valid',
      sql`${t.deactivatedAt} IS NULL OR ${t.deactivatedAt} >= ${t.activatedAt}`,
    ),
    check(
      'portal_publication_activations_deactivation_valid',
      sql`(${t.deactivatedAt} IS NULL AND ${t.deactivationReason} IS NULL) OR (${t.deactivatedAt} IS NOT NULL AND ${t.deactivationReason} IN ('disabled', 'archived', 'replaced'))`,
    ),
  ],
)

// ── portal_link_categories ─────────────────────────────────────────

/**
 * A single-purpose, tenant/Property/Portal-bound authorization for one hero
 * source object. Browser callers receive only `id`; the private object key is
 * server-derived and fenced again by database checks.
 */
export const portalUploadIssuances = pgTable(
  'portal_upload_issuances',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    purpose: varchar('purpose', { length: 32 }).notNull().default('hero_image'),
    objectKey: varchar('object_key', { length: 500 }).notNull(),
    contentType: varchar('content_type', { length: 64 }).notNull(),
    declaredSizeBytes: integer('declared_size_bytes').notNull(),
    maxSizeBytes: integer('max_size_bytes').notNull(),
    state: varchar('state', { length: 20 }).notNull().default('issued'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    heroDerivativeKey: varchar('hero_derivative_key', { length: 500 }),
    thumbnailDerivativeKey: varchar('thumbnail_derivative_key', { length: 500 }),
    heroImageUrl: varchar('hero_image_url', { length: 500 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('portal_upload_issuances_object_key_unique').on(t.objectKey),
    uniqueIndex('portal_upload_issuances_one_processing_per_portal')
      .on(t.organizationId, t.portalId, t.purpose)
      .where(sql`state = 'consumed'`),
    index('portal_upload_issuances_scope_idx').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.id,
    ),
    index('portal_upload_issuances_expiry_idx').on(t.state, t.expiresAt),
    foreignKey({
      name: 'portal_upload_issuances_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    check('portal_upload_issuances_purpose_valid', sql`${t.purpose} = 'hero_image'`),
    check(
      'portal_upload_issuances_content_type_valid',
      sql`${t.contentType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check(
      'portal_upload_issuances_size_envelope_valid',
      sql`${t.declaredSizeBytes} BETWEEN 1 AND ${t.maxSizeBytes} AND ${t.maxSizeBytes} = 10485760`,
    ),
    check('portal_upload_issuances_expiry_valid', sql`${t.expiresAt} > ${t.issuedAt}`),
    check(
      'portal_upload_issuances_source_key_valid',
      sql`${t.objectKey} = 'private/portal-uploads/' || ${t.id}::text || '/source.' || CASE ${t.contentType} WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' ELSE NULL END`,
    ),
    check(
      'portal_upload_issuances_state_valid',
      sql`${t.state} IN ('issued', 'consumed', 'finalized', 'superseded', 'rejected', 'expired')`,
    ),
    check(
      'portal_upload_issuances_lifecycle_valid',
      sql`(
        (${t.state} = 'issued' AND ${t.consumedAt} IS NULL AND ${t.finalizedAt} IS NULL AND ${t.supersededAt} IS NULL AND ${t.rejectedAt} IS NULL AND ${t.expiredAt} IS NULL)
        OR (${t.state} = 'consumed' AND ${t.consumedAt} IS NOT NULL AND ${t.finalizedAt} IS NULL AND ${t.supersededAt} IS NULL AND ${t.rejectedAt} IS NULL AND ${t.expiredAt} IS NULL)
        OR (${t.state} = 'finalized' AND ${t.consumedAt} IS NOT NULL AND ${t.finalizedAt} IS NOT NULL AND ${t.supersededAt} IS NULL AND ${t.rejectedAt} IS NULL AND ${t.expiredAt} IS NULL AND ${t.heroDerivativeKey} IS NOT NULL AND ${t.thumbnailDerivativeKey} IS NOT NULL AND ${t.heroImageUrl} IS NOT NULL)
        OR (${t.state} = 'superseded' AND ${t.consumedAt} IS NOT NULL AND ${t.finalizedAt} IS NULL AND ${t.supersededAt} IS NOT NULL AND ${t.rejectedAt} IS NULL AND ${t.expiredAt} IS NULL)
        OR (${t.state} = 'rejected' AND ${t.consumedAt} IS NULL AND ${t.finalizedAt} IS NULL AND ${t.supersededAt} IS NULL AND ${t.rejectedAt} IS NOT NULL AND ${t.expiredAt} IS NULL)
        OR (${t.state} = 'expired' AND ${t.consumedAt} IS NULL AND ${t.finalizedAt} IS NULL AND ${t.supersededAt} IS NULL AND ${t.rejectedAt} IS NULL AND ${t.expiredAt} IS NOT NULL)
      )`,
    ),
    check(
      'portal_upload_issuances_derivative_keys_valid',
      sql`(
        (${t.heroDerivativeKey} IS NULL AND ${t.thumbnailDerivativeKey} IS NULL)
        OR (
          ${t.heroDerivativeKey} = 'public/portal-heroes/' || ${t.id}::text || '/hero.webp'
          AND ${t.thumbnailDerivativeKey} = 'public/portal-heroes/' || ${t.id}::text || '/thumbnail.webp'
          AND ${t.heroDerivativeKey} <> ${t.objectKey}
          AND ${t.thumbnailDerivativeKey} <> ${t.objectKey}
        )
      )`,
    ),
    check(
      'portal_upload_issuances_publication_valid',
      sql`(
        (${t.state} = 'finalized' AND ${t.heroDerivativeKey} IS NOT NULL AND ${t.thumbnailDerivativeKey} IS NOT NULL AND ${t.heroImageUrl} IS NOT NULL)
        OR (${t.state} <> 'finalized' AND ${t.heroDerivativeKey} IS NULL AND ${t.thumbnailDerivativeKey} IS NULL AND ${t.heroImageUrl} IS NULL)
      )`,
    ),
  ],
)

// ── portal_link_categories ────────────────────────────────────────────────

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
  (t) => [
    index('portal_link_categories_portal_idx').on(t.portalId),
    uniqueIndex('portal_link_categories_org_portal_id_key').on(
      t.organizationId,
      t.portalId,
      t.id,
    ),
    foreignKey({
      name: 'portal_link_categories_portal_tenant_fk',
      columns: [t.organizationId, t.portalId],
      foreignColumns: [portals.organizationId, portals.id],
    }).onDelete('cascade'),
  ],
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
  (t) => [
    index('portal_links_portal_idx').on(t.portalId),
    index('portal_links_category_idx').on(t.categoryId),
    uniqueIndex('portal_links_org_portal_id_key').on(t.organizationId, t.portalId, t.id),
    foreignKey({
      name: 'portal_links_category_tenant_fk',
      columns: [t.organizationId, t.portalId, t.categoryId],
      foreignColumns: [
        portalLinkCategories.organizationId,
        portalLinkCategories.portalId,
        portalLinkCategories.id,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'portal_links_portal_tenant_fk',
      columns: [t.organizationId, t.portalId],
      foreignColumns: [portals.organizationId, portals.id],
    }).onDelete('cascade'),
  ],
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
  (t) => [
    uniqueIndex('portal_group_members_portal_id_unique').on(t.portalId),
    index('portal_group_members_group_idx').on(t.portalGroupId),
  ],
)
