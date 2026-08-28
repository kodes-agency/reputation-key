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
  boolean,
  text,
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
    primaryGuestLocale: varchar('primary_guest_locale', { length: 35 })
      .notNull()
      .default('en'),
    additionalGuestLocales: jsonb('additional_guest_locales').notNull().default([]),
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
    check(
      'portals_primary_guest_locale_active',
      sql`${t.primaryGuestLocale} IN ('en', 'bg')`,
    ),
    check(
      'portals_additional_guest_locales_array',
      sql`jsonb_typeof(${t.additionalGuestLocales}) = 'array' AND ${t.additionalGuestLocales} <@ '["en", "bg"]'::jsonb`,
    ),
  ],
)

// ── Property Brand Profile and localized guest content ────────────

export const propertyPortalBrandProfiles = pgTable(
  'property_portal_brand_profiles',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    logoUrl: varchar('logo_url', { length: 500 }),
    defaultHeroImageUrl: varchar('default_hero_image_url', { length: 500 }),
    primaryColor: varchar('primary_color', { length: 7 }).notNull(),
    backgroundColor: varchar('background_color', { length: 7 }).notNull(),
    textColor: varchar('text_color', { length: 7 }).notNull(),
    version: integer('version').notNull().default(1),
    updatedBy: varchar('updated_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('property_portal_brand_profiles_property_unique').on(
      t.organizationId,
      t.propertyId,
    ),
    uniqueIndex('property_portal_brand_profiles_scope_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    foreignKey({
      name: 'property_portal_brand_profiles_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    check(
      'property_portal_brand_profiles_palette_valid',
      sql`${t.primaryColor} ~ '^#[0-9A-Fa-f]{6}$' AND ${t.backgroundColor} ~ '^#[0-9A-Fa-f]{6}$' AND ${t.textColor} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
    check('property_portal_brand_profiles_version_positive', sql`${t.version} >= 1`),
  ],
)

export const propertyPortalBrandContents = pgTable(
  'property_portal_brand_contents',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    locale: varchar('locale', { length: 35 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    shortDescription: varchar('short_description', { length: 500 }).notNull(),
    version: integer('version').notNull().default(1),
    updatedBy: varchar('updated_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('property_portal_brand_contents_locale_unique').on(
      t.organizationId,
      t.propertyId,
      t.locale,
    ),
    foreignKey({
      name: 'property_portal_brand_contents_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    check(
      'property_portal_brand_contents_locale_active',
      sql`${t.locale} IN ('en', 'bg')`,
    ),
    check('property_portal_brand_contents_version_positive', sql`${t.version} >= 1`),
  ],
)

export const portalLocalizedOverrides = pgTable(
  'portal_localized_overrides',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    locale: varchar('locale', { length: 35 }).notNull(),
    title: varchar('title', { length: 120 }),
    shortDescription: varchar('short_description', { length: 500 }),
    heroImageUrl: varchar('hero_image_url', { length: 500 }),
    version: integer('version').notNull().default(1),
    updatedBy: varchar('updated_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('portal_localized_overrides_locale_unique').on(
      t.organizationId,
      t.portalId,
      t.locale,
    ),
    foreignKey({
      name: 'portal_localized_overrides_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    check('portal_localized_overrides_locale_active', sql`${t.locale} IN ('en', 'bg')`),
    check('portal_localized_overrides_version_positive', sql`${t.version} >= 1`),
    check(
      'portal_localized_overrides_has_value',
      sql`${t.title} IS NOT NULL OR ${t.shortDescription} IS NOT NULL OR ${t.heroImageUrl} IS NOT NULL`,
    ),
  ],
)

// ── Effective-dated derived Portal Health ─────────────────────────

export const portalHealthIntervals = pgTable(
  'portal_health_intervals',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    reason: varchar('reason', { length: 80 }).notNull(),
    sourceVersion: varchar('source_version', { length: 160 }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('portal_health_intervals_one_current')
      .on(t.organizationId, t.portalId)
      .where(sql`${t.effectiveTo} IS NULL`),
    index('portal_health_intervals_history_idx').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.effectiveFrom,
    ),
    foreignKey({
      name: 'portal_health_intervals_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    check(
      'portal_health_intervals_status_valid',
      sql`${t.status} IN ('healthy', 'degraded', 'unavailable')`,
    ),
    check(
      'portal_health_intervals_interval_valid',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    check(
      'portal_health_intervals_observation_valid',
      sql`${t.observedAt} >= ${t.effectiveFrom}`,
    ),
  ],
)

// ── Property-owned Approved Destinations ──────────────────────────

export const portalApprovedDestinations = pgTable(
  'portal_approved_destinations',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    normalizedUri: varchar('normalized_uri', { length: 500 }).notNull(),
    hostname: varchar('hostname', { length: 255 }).notNull(),
    sourceType: varchar('source_type', { length: 20 }).notNull(),
    approvalState: varchar('approval_state', { length: 20 }).notNull(),
    validationVersion: varchar('validation_version', { length: 80 }).notNull(),
    requestedBy: varchar('requested_by', { length: 255 }).notNull(),
    approvedBy: varchar('approved_by', { length: 255 }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    disabledReason: varchar('disabled_reason', { length: 500 }),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('portal_approved_destinations_uri_unique').on(
      t.organizationId,
      t.propertyId,
      t.normalizedUri,
    ),
    uniqueIndex('portal_approved_destinations_scope_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    foreignKey({
      name: 'portal_approved_destinations_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    check(
      'portal_approved_destinations_source_valid',
      sql`${t.sourceType} IN ('recognized', 'custom', 'provider')`,
    ),
    check(
      'portal_approved_destinations_state_valid',
      sql`${t.approvalState} IN ('pending', 'approved', 'disabled', 'quarantined')`,
    ),
    check(
      'portal_approved_destinations_approval_valid',
      sql`(${t.approvalState} = 'approved' AND ${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL AND ${t.disabledAt} IS NULL) OR (${t.approvalState} <> 'approved')`,
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
    encryptedRawToken: text('encrypted_raw_token'),
    addressEncryptionKeyVersion: integer('address_encryption_key_version'),
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
    uniqueIndex('portal_tokens_scope_id_key').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.id,
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
    check(
      'portal_tokens_encrypted_address_pair_valid',
      sql`(${t.encryptedRawToken} IS NULL) = (${t.addressEncryptionKeyVersion} IS NULL)`,
    ),
  ],
)

// Public, high-entropy channel marker bound to one stable Portal address.
// It is not an alternate Portal identity: public resolution still requires
// the bound address token and the exact active publication.
export const portalAccessArtifacts = pgTable(
  'portal_access_artifacts',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    portalTokenId: uuid('portal_token_id').notNull(),
    channel: varchar('channel', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('published'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (t) => [
    index('portal_access_artifacts_portal_idx').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
    ),
    uniqueIndex('portal_access_artifacts_token_channel_key')
      .on(t.portalTokenId, t.channel)
      .where(sql`${t.status} = 'published'`),
    uniqueIndex('portal_access_artifacts_scope_id_key').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.id,
    ),
    foreignKey({
      name: 'portal_access_artifacts_token_scope_fk',
      columns: [t.organizationId, t.propertyId, t.portalId, t.portalTokenId],
      foreignColumns: [
        portalTokens.organizationId,
        portalTokens.propertyId,
        portalTokens.portalId,
        portalTokens.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'portal_access_artifacts_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    check('portal_access_artifacts_channel_valid', sql`${t.channel} IN ('qr', 'nfc')`),
    check(
      'portal_access_artifacts_status_valid',
      sql`${t.status} IN ('published', 'retiring', 'retired', 'revoked')`,
    ),
    check(
      'portal_access_artifacts_retirement_valid',
      sql`(${t.status} = 'published' AND ${t.retiredAt} IS NULL) OR (${t.status} <> 'published' AND ${t.retiredAt} IS NOT NULL AND ${t.retiredAt} >= ${t.publishedAt})`,
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
    localeSet: jsonb('locale_set').notNull().default(['en']),
    languagePackVersions: jsonb('language_pack_versions')
      .notNull()
      .default(sql`'{"en": "guest-ui-en-v1"}'::jsonb`),
    localizedContent: jsonb('localized_content').notNull().default({}),
    brandProfileVersion: integer('brand_profile_version'),
    privateFeedbackThreshold: integer('private_feedback_threshold').notNull(),
    contactRequestEnabled: boolean('contact_request_enabled').notNull().default(false),
    contactNoticeId: varchar('contact_notice_id', { length: 100 }),
    contactNoticeVersion: varchar('contact_notice_version', { length: 100 }),
    contactNoticeDigest: varchar('contact_notice_digest', { length: 64 }),
    contactNoticeLocale: varchar('contact_notice_locale', { length: 35 }),
    contactRequestPurpose: varchar('contact_request_purpose', { length: 50 })
      .notNull()
      .default('manager_follow_up'),
    contactRetentionPolicyVersion: varchar('contact_retention_policy_version', {
      length: 100,
    })
      .notNull()
      .default('guest-contact-retention-30d-v1'),
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
    uniqueIndex('portal_publication_snapshots_contact_evidence_binding_key').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.id,
      t.version,
      t.configurationDigest,
      t.contactRequestEnabled,
      t.contactNoticeId,
      t.contactNoticeVersion,
      t.contactNoticeDigest,
      t.contactNoticeLocale,
      t.contactRequestPurpose,
      t.contactRetentionPolicyVersion,
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
    check(
      'portal_publication_snapshots_locale_valid',
      sql`${t.guestLocale} IN ('en', 'bg')`,
    ),
    check(
      'portal_publication_snapshots_language_pack_valid',
      sql`${t.languagePackVersion} IN ('guest-ui-en-v1', 'guest-ui-bg-v1')`,
    ),
    check(
      'portal_publication_snapshots_locale_set_valid',
      sql`jsonb_typeof(${t.localeSet}) = 'array' AND ${t.localeSet} <@ '["en", "bg"]'::jsonb AND ${t.localeSet} @> jsonb_build_array(${t.guestLocale})`,
    ),
    check(
      'portal_publication_snapshots_language_packs_object',
      sql`jsonb_typeof(${t.languagePackVersions}) = 'object'`,
    ),
    check(
      'portal_publication_snapshots_localized_content_object',
      sql`jsonb_typeof(${t.localizedContent}) = 'object'`,
    ),
    check(
      'portal_publication_snapshots_brand_version_positive',
      sql`${t.brandProfileVersion} IS NULL OR ${t.brandProfileVersion} >= 1`,
    ),
    check(
      'portal_publication_snapshots_threshold_valid',
      sql`${t.privateFeedbackThreshold} BETWEEN 1 AND 5`,
    ),
    check(
      'portal_publication_snapshots_contact_evidence_valid',
      sql`${t.contactRequestEnabled} = false OR (
        ${t.contactNoticeId} IS NOT NULL
        AND char_length(${t.contactNoticeId}) BETWEEN 1 AND 100
        AND ${t.contactNoticeVersion} IS NOT NULL
        AND char_length(${t.contactNoticeVersion}) BETWEEN 1 AND 100
        AND ${t.contactNoticeDigest} ~ '^[0-9a-f]{64}$'
        AND ${t.contactNoticeLocale} ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
      )`,
    ),
    check(
      'portal_publication_snapshots_contact_purpose_valid',
      sql`${t.contactRequestPurpose} = 'manager_follow_up'`,
    ),
    check(
      'portal_publication_snapshots_contact_retention_valid',
      sql`${t.contactRetentionPolicyVersion} = 'guest-contact-retention-30d-v1'`,
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

// ── durable unpublished working-copy changes ─────────────────────

/**
 * An append-only record that a resolved publication input changed after at
 * least one snapshot existed. Successful publication resolves every open row
 * to the exact immutable snapshot; rollback never claims unpublished work.
 */
export const portalPendingContentChanges = pgTable(
  'portal_pending_content_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    changeKind: varchar('change_kind', { length: 40 }).notNull(),
    changeKey: varchar('change_key', { length: 160 }).notNull().default('all'),
    sourceVersion: varchar('source_version', { length: 160 }).notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
    resolvedSnapshotId: uuid('resolved_snapshot_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('portal_pending_content_changes_source_unique').on(
      t.organizationId,
      t.portalId,
      t.changeKind,
      t.changeKey,
      t.sourceVersion,
    ),
    index('portal_pending_content_changes_open_idx')
      .on(t.organizationId, t.propertyId, t.portalId, t.changedAt)
      .where(sql`${t.resolvedAt} IS NULL`),
    foreignKey({
      name: 'portal_pending_content_changes_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'portal_pending_content_changes_snapshot_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId, t.resolvedSnapshotId],
      foreignColumns: [
        portalPublicationSnapshots.organizationId,
        portalPublicationSnapshots.propertyId,
        portalPublicationSnapshots.portalId,
        portalPublicationSnapshots.id,
      ],
    }).onDelete('restrict'),
    check(
      'portal_pending_content_changes_kind_valid',
      sql`${t.changeKind} IN ('portal_configuration', 'portal_links', 'property_brand_profile', 'property_brand_content', 'portal_localized_override', 'approved_destination')`,
    ),
    check(
      'portal_pending_content_changes_resolution_pair',
      sql`(${t.resolvedSnapshotId} IS NULL) = (${t.resolvedAt} IS NULL)`,
    ),
    check(
      'portal_pending_content_changes_resolution_time',
      sql`${t.resolvedAt} IS NULL OR ${t.resolvedAt} >= ${t.changedAt}`,
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
    sourceDeletedAt: timestamp('source_deleted_at', { withTimezone: true }),
    orphanDerivativesDeletedAt: timestamp('orphan_derivatives_deleted_at', {
      withTimezone: true,
    }),
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
    index('portal_upload_issuances_source_cleanup_idx')
      .on(t.expiresAt, t.id)
      .where(
        sql`${t.sourceDeletedAt} IS NULL OR (${t.orphanDerivativesDeletedAt} IS NULL AND ${t.state} IN ('superseded', 'rejected', 'expired'))`,
      ),
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
    check(
      'portal_upload_issuances_source_cleanup_valid',
      sql`${t.sourceDeletedAt} IS NULL OR ${t.state} IN ('finalized', 'superseded', 'rejected', 'expired')`,
    ),
    check(
      'portal_upload_issuances_orphan_derivative_cleanup_valid',
      sql`${t.orphanDerivativesDeletedAt} IS NULL OR ${t.state} IN ('superseded', 'rejected', 'expired')`,
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
    propertyId: uuid('property_id').notNull(),
    label: varchar('label', { length: 100 }).notNull(),
    destinationId: uuid('destination_id'),
    url: varchar('url', { length: 500 }),
    legacyDestinationState: varchar('legacy_destination_state', { length: 20 })
      .notNull()
      .default('unclassified'),
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
    foreignKey({
      name: 'portal_links_destination_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.destinationId],
      foreignColumns: [
        portalApprovedDestinations.organizationId,
        portalApprovedDestinations.propertyId,
        portalApprovedDestinations.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'portal_links_property_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('cascade'),
    check(
      'portal_links_destination_authority_valid',
      sql`(${t.destinationId} IS NOT NULL AND ${t.url} IS NULL AND ${t.legacyDestinationState} = 'migrated') OR (${t.destinationId} IS NULL AND ${t.url} IS NOT NULL AND ${t.legacyDestinationState} IN ('unclassified', 'quarantined'))`,
    ),
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
