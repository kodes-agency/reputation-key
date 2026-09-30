// Portal publication — Drizzle schema for the immutable publication snapshots,
// their activation history and the pending-content-change ledger.
// Split out of portal.schema.ts so the working Portal model and the published
// evidence live in separate files. The data-fate guard classifies each pgTable
// by the file that exports it, so nothing here is re-exported from
// portal.schema.ts; consumers import these tables from this file (or the barrel).
// snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core'
import {
  GUEST_LANGUAGE_PACK_SQL_PATTERN,
  GUEST_LOCALE_JSONB_LITERAL,
  GUEST_LOCALE_SQL_LIST,
} from '../../guest-locale-schemas'
import { portals } from './portal.schema'

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
      sql`${t.guestLocale} IN (${sql.raw(GUEST_LOCALE_SQL_LIST)})`,
    ),
    check(
      'portal_publication_snapshots_language_pack_valid',
      sql`${t.languagePackVersion} ~ '${sql.raw(GUEST_LANGUAGE_PACK_SQL_PATTERN)}'`,
    ),
    check(
      'portal_publication_snapshots_locale_set_valid',
      sql`jsonb_typeof(${t.localeSet}) = 'array' AND ${t.localeSet} <@ '${sql.raw(GUEST_LOCALE_JSONB_LITERAL)}'::jsonb AND ${t.localeSet} @> jsonb_build_array(${t.guestLocale})`,
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
