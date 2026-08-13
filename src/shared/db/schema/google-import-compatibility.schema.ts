import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { properties } from './property.schema'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })
const generation = (name: string) => bigint(name, { mode: 'number' })

export const legacyGbpCacheDataTypeEnum = pgEnum('gbp_cache_data_type', ['location'])
export const legacyImportJobStatusEnum = pgEnum('import_job_status', [
  'queued',
  'in_progress',
  'completed',
  'failed',
  'completed_with_skips',
  'completed_with_failures',
])

export const legacyGbpCache = pgTable(
  'gbp_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    gbpPlaceId: varchar('gbp_place_id', { length: 500 }).notNull(),
    dataType: legacyGbpCacheDataTypeEnum('data_type').notNull(),
    payload: jsonb('payload').notNull(),
    googleAttribution: text('google_attribution'),
    fetchedAt: timestamptz('fetched_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('gbp_cache_org_property_type_unique').on(
      table.organizationId,
      table.propertyId,
      table.dataType,
    ),
  ],
)

export const legacyGbpImportJobs = pgTable(
  'gbp_import_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    initiatedBy: varchar('initiated_by', { length: 255 }).notNull(),
    status: legacyImportJobStatusEnum('status').notNull().default('queued'),
    totalCount: integer('total_count').notNull().default(0),
    importedCount: integer('imported_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index('gbp_import_jobs_org_idx').on(table.organizationId)],
)
export const googleConnectedEventIssuanceVersionEnum = pgEnum(
  'google_connected_event_issuance_version',
  ['v1', 'v2'],
)
export const googleOauthStateIssuanceVersionEnum = pgEnum(
  'google_oauth_state_issuance_version',
  ['signed-v1', 'opaque-v2'],
)
export const legacyImportControlStateEnum = pgEnum('legacy_import_control_state', [
  'open',
  'quiescing',
  'closed',
])
export const legacyImportEffectLeaseStateEnum = pgEnum(
  'legacy_import_effect_lease_state',
  ['active', 'released'],
)
export const legacyImportHistoryStatusEnum = pgEnum('legacy_import_history_status', [
  'completed',
  'completed_with_issues',
  'failed',
])

export const gbpImportLegacyHistory = pgTable(
  'gbp_import_legacy_history',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    initiatedBy: varchar('initiated_by', { length: 255 }).notNull(),
    contractVersion: varchar('contract_version', { length: 32 })
      .notNull()
      .default('legacy-v1'),
    originalStatus: varchar('original_status', { length: 40 }).notNull(),
    normalizedStatus: legacyImportHistoryStatusEnum('normalized_status').notNull(),
    totalCount: integer('total_count').notNull(),
    importedCount: integer('imported_count').notNull(),
    skippedCount: integer('skipped_count').notNull(),
    failedCount: integer('failed_count').notNull(),
    originalCreatedAt: timestamptz('original_created_at').notNull(),
    originalUpdatedAt: timestamptz('original_updated_at').notNull(),
    archivedAt: timestamptz('archived_at').notNull(),
    rowDigest: varchar('row_digest', { length: 64 }).notNull(),
    abandonedBy: varchar('abandoned_by', { length: 255 }),
    abandonReason: varchar('abandon_reason', { length: 500 }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('gbp_import_legacy_history_org_created_idx').on(
      table.organizationId,
      table.originalCreatedAt,
      table.id,
    ),
    check(
      'gbp_import_legacy_history_contract_check',
      sql`${table.contractVersion} = 'legacy-v1'`,
    ),
    check(
      'gbp_import_legacy_history_original_status_check',
      sql`${table.originalStatus} IN ('completed', 'completed_with_skips', 'completed_with_failures', 'failed')`,
    ),
    check(
      'gbp_import_legacy_history_count_check',
      sql`${table.totalCount} >= 0 AND ${table.importedCount} >= 0 AND ${table.skippedCount} >= 0 AND ${table.failedCount} >= 0`,
    ),
    check(
      'gbp_import_legacy_history_digest_check',
      sql`${table.rowDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'gbp_import_legacy_history_abandonment_check',
      sql`(${table.abandonedBy} IS NULL) = (${table.abandonReason} IS NULL)`,
    ),
  ],
)

export const legacyImportControl = pgTable(
  'legacy_import_control',
  {
    environment: varchar('environment', { length: 64 }).primaryKey(),
    state: legacyImportControlStateEnum('state').notNull().default('open'),
    generation: generation('generation').notNull().default(1),
    connectedEventIssuance: googleConnectedEventIssuanceVersionEnum(
      'connected_event_issuance',
    )
      .notNull()
      .default('v1'),
    oauthStateIssuance: googleOauthStateIssuanceVersionEnum('oauth_state_issuance')
      .notNull()
      .default('signed-v1'),
    connectedEventConvergedAt: timestamptz('connected_event_converged_at'),
    oauthStateConvergedAt: timestamptz('oauth_state_converged_at'),
    v1StateDrainNotBefore: timestamptz('v1_state_drain_not_before'),
    v1EventsDrainedAt: timestamptz('v1_events_drained_at'),
    quiescingAt: timestamptz('quiescing_at'),
    closedAt: timestamptz('closed_at'),
    operatorId: varchar('operator_id', { length: 255 }),
    reason: varchar('reason', { length: 500 }),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    check('legacy_import_control_generation_check', sql`${table.generation} >= 1`),
    check(
      'legacy_import_control_event_issuance_check',
      sql`(${table.connectedEventIssuance} = 'v1' AND ${table.connectedEventConvergedAt} IS NULL) OR (${table.connectedEventIssuance} = 'v2' AND ${table.connectedEventConvergedAt} IS NOT NULL)`,
    ),
    check(
      'legacy_import_control_oauth_issuance_check',
      sql`(${table.oauthStateIssuance} = 'signed-v1' AND ${table.oauthStateConvergedAt} IS NULL AND ${table.v1StateDrainNotBefore} IS NULL) OR (${table.oauthStateIssuance} = 'opaque-v2' AND ${table.connectedEventIssuance} = 'v2' AND ${table.oauthStateConvergedAt} IS NOT NULL AND ${table.v1StateDrainNotBefore} IS NOT NULL)`,
    ),
    check(
      'legacy_import_control_state_check',
      sql`(${table.state} = 'open' AND ${table.quiescingAt} IS NULL AND ${table.closedAt} IS NULL) OR (${table.state} = 'quiescing' AND ${table.quiescingAt} IS NOT NULL AND ${table.closedAt} IS NULL) OR (${table.state} = 'closed' AND ${table.quiescingAt} IS NOT NULL AND ${table.closedAt} IS NOT NULL)`,
    ),
    check(
      'legacy_import_control_close_gate_check',
      sql`${table.state} = 'open' OR (${table.oauthStateIssuance} = 'opaque-v2' AND ${table.v1EventsDrainedAt} IS NOT NULL AND ${table.quiescingAt} >= ${table.v1StateDrainNotBefore})`,
    ),
    check(
      'legacy_import_control_operator_check',
      sql`(${table.operatorId} IS NULL) = (${table.reason} IS NULL)`,
    ),
  ],
)

export const legacyImportEffectLeases = pgTable(
  'legacy_import_effect_leases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    environment: varchar('environment', { length: 64 }).notNull(),
    jobId: uuid('job_id').notNull(),
    generation: generation('generation').notNull(),
    workerId: varchar('worker_id', { length: 255 }).notNull(),
    state: legacyImportEffectLeaseStateEnum('state').notNull().default('active'),
    acquiredAt: timestamptz('acquired_at').notNull(),
    releasedAt: timestamptz('released_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({
      name: 'legacy_import_effect_leases_control_fk',
      columns: [table.environment],
      foreignColumns: [legacyImportControl.environment],
    })
      .onDelete('restrict')
      .onUpdate('no action'),
    uniqueIndex('legacy_import_effect_leases_one_active_job_idx')
      .on(table.environment, table.jobId)
      .where(sql`${table.state} = 'active'`),
    index('legacy_import_effect_leases_active_idx').on(
      table.environment,
      table.state,
      table.generation,
      table.acquiredAt,
    ),
    check('legacy_import_effect_leases_generation_check', sql`${table.generation} >= 1`),
    check(
      'legacy_import_effect_leases_state_check',
      sql`(${table.state} = 'active' AND ${table.releasedAt} IS NULL) OR (${table.state} = 'released' AND ${table.releasedAt} IS NOT NULL)`,
    ),
  ],
)
