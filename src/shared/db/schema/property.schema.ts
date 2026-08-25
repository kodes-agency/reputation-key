// Property context — Drizzle schema for properties table
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import { createdAtColumn, updatedAtColumn, deletedAtColumn } from '../columns'
import { googleConnections } from './google-connection.schema'
import { REPLY_LANGUAGE_TAG_SQL_PATTERN } from '../../reply-language-catalogue'
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    // Tenant-confirmed canonical BCP 47 tag used as the default language for
    // public review replies (for example, bg-Cyrl-BG). Nullable for legacy
    // properties that have not chosen a reply language yet.
    defaultReplyLanguage: varchar('default_reply_language', { length: 35 }),
    googleConnectionId: uuid('google_connection_id').references(
      () => googleConnections.id,
      { onDelete: 'set null' },
    ),
    // Canonical Google binding/profile columns. Provider resource suffixes are
    // stored only in the account/location fields.
    address: text('address'),
    gbpAccountId: varchar('gbp_account_id', { length: 255 }),
    gbpLocationId: varchar('gbp_location_id', { length: 255 }),
    profileVersion: integer('profile_version').notNull().default(1),
    googleBindingState: varchar('google_binding_state', { length: 40 })
      .notNull()
      .default('unbound'),
    profileSource: varchar('profile_source', { length: 32 }).notNull().default('legacy'),
    profileConfirmedAt: timestamp('profile_confirmed_at', { withTimezone: true }),
    profileConfirmedBy: varchar('profile_confirmed_by', { length: 255 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
    // B1.5: Lifecycle state machine (migration 0009)
    lifecycleState: varchar('lifecycle_state', { length: 20 })
      .notNull()
      .default('active'),
    lifecycleReason: text('lifecycle_reason'),
    lifecycleStateChangedAt: timestamp('lifecycle_state_changed_at', {
      withTimezone: true,
    }).defaultNow(),
    purgeScheduledFor: timestamp('purge_scheduled_for', { withTimezone: true }),
    lifecycleInitiatedBy: varchar('lifecycle_initiated_by', { length: 255 }),
    // PRE17B / BQR-1.1: Property processing profile + routing (migration 0006)
    countryCode: varchar('country_code', { length: 2 }),
    countrySource: text('country_source').default('organization_default'),
    timezoneSource: text('timezone_source').default('legacy'),
    timezoneResolvedAt: timestamp('timezone_resolved_at', { withTimezone: true }),
    processingRegion: text('processing_region').default('unresolved'),
    // REG-01 expand phase: canonical immutable Data Cell assignment. Nullable
    // only for unresolved and pre-backfill rows; new application writes set it.
    dataCellId: text('data_cell_id'),
    processingRegionSource: text('processing_region_source').default('country_default'),
    routingPolicyVersion: integer('routing_policy_version').notNull().default(1),
    processingRegionResolvedAt: timestamp('processing_region_resolved_at', {
      withTimezone: true,
    }),
    sourceEpoch: integer('source_epoch').notNull().default(0),
  },
  (t) => ({
    orgIdKey: uniqueIndex('properties_org_id_key').on(t.organizationId, t.id),
    orgSlugUnique: uniqueIndex('properties_org_slug_unique')
      .on(t.organizationId, t.slug)
      .where(sql`deleted_at IS NULL`),
    orgIdx: index('properties_org_idx').on(t.organizationId),
    fleetNameCursorIdx: index('properties_org_lower_name_id_active_idx')
      .on(t.organizationId, sql`lower(${t.name})`, t.id)
      .where(sql`${t.deletedAt} IS NULL`),
    // F6: declared in Drizzle for schema parity, but created only by the
    // dedicated autocommit sidecar (never by the transactional migrator).
    orgGbpLocationIdUnique: uniqueIndex('properties_org_gbp_location_id_unique')
      .on(t.organizationId, t.gbpLocationId)
      .where(sql`gbp_location_id IS NOT NULL AND deleted_at IS NULL`),
    // Migration 0006: backfill queue for unresolved processing region
    routingBackfillIdx: index('properties_routing_backfill_idx')
      .on(t.routingPolicyVersion, t.id)
      .where(sql`processing_region = 'unresolved' AND deleted_at IS NULL`),
    // Migration 0009: lifecycle sweep lookup (all non-purged rows).
    lifecycleStateIdx: index('properties_lifecycle_state_idx')
      .on(t.lifecycleState)
      .where(sql`lifecycle_state <> 'purged'`),
    googleBindingStateCheck: check(
      'properties_google_binding_state_valid',
      sql`${t.googleBindingState} IN ('unbound', 'account_confirmation_required', 'active', 'disconnected')`,
    ),
    googleBindingTupleCheck: check(
      'properties_google_binding_tuple_valid',
      sql`(
        (${t.googleBindingState} = 'unbound' AND ${t.gbpAccountId} IS NULL AND ${t.gbpLocationId} IS NULL)
        OR (${t.googleBindingState} = 'account_confirmation_required' AND ${t.gbpAccountId} IS NULL AND ${t.gbpLocationId} IS NOT NULL)
        OR (${t.googleBindingState} IN ('active', 'disconnected') AND ${t.googleConnectionId} IS NOT NULL AND ${t.gbpAccountId} IS NOT NULL AND ${t.gbpLocationId} IS NOT NULL)
      )`,
    ),
    googleBindingSuffixCheck: check(
      'properties_google_binding_suffix_valid',
      sql`(
        (${t.gbpAccountId} IS NULL OR (char_length(${t.gbpAccountId}) >= 1 AND char_length(${t.gbpAccountId}) <= 255 AND ${t.gbpAccountId} !~ '[/?#[:space:][:cntrl:]]'))
        AND (${t.gbpLocationId} IS NULL OR (char_length(${t.gbpLocationId}) >= 1 AND char_length(${t.gbpLocationId}) <= 255 AND ${t.gbpLocationId} !~ '[/?#[:space:][:cntrl:]]'))
      )`,
    ),
    googleProfileVersionCheck: check(
      'properties_google_profile_version_valid',
      sql`${t.profileVersion} >= 1`,
    ),
    defaultReplyLanguageCheck: check(
      'properties_default_reply_language_valid',
      sql`${t.defaultReplyLanguage} IS NULL OR ${t.defaultReplyLanguage} ~ ${sql.raw(`'${REPLY_LANGUAGE_TAG_SQL_PATTERN}'`)}`,
    ),
    googleProfileConfirmationCheck: check(
      'properties_google_profile_confirmation_valid',
      sql`(
        (${t.profileSource} = 'legacy' AND ${t.profileConfirmedAt} IS NULL AND ${t.profileConfirmedBy} IS NULL)
        OR (${t.profileSource} = 'tenant_confirmed' AND ${t.profileConfirmedAt} IS NOT NULL AND ${t.profileConfirmedBy} IS NOT NULL)
      )`,
    ),
    // Migration 0009: pins the lifecycle machine's persisted states.
    lifecycleStateCheck: check(
      'properties_lifecycle_state_valid',
      sql`${t.lifecycleState} IN ('active', 'suspended', 'archived', 'disconnecting', 'purge_pending', 'purging', 'purged')`,
    ),
    dataCellIdCheck: check(
      'properties_data_cell_id_valid',
      sql`${t.dataCellId} IS NULL OR ${t.dataCellId} IN ('us', 'europe', 'global')`,
    ),
  }),
)
