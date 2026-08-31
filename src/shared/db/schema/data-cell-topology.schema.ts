import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'

/**
 * Durable coordination authority for the one-cell beta topology cutover.
 * Admissions share-lock this singleton while the operator owns its fence.
 */
export const dataCellTopologyCutovers = pgTable(
  'data_cell_topology_cutovers',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    cutoverKey: varchar('cutover_key', { length: 64 }).notNull().unique(),
    state: varchar('state', { length: 16 }).notNull().default('open'),
    phase: varchar('phase', { length: 32 }).notNull().default('properties'),
    targetCellId: varchar('target_cell_id', { length: 16 }).notNull(),
    targetPolicyVersion: integer('target_policy_version').notNull(),
    targetProjectId: varchar('target_project_id', { length: 255 }),
    targetEnvironmentId: varchar('target_environment_id', { length: 255 }),
    propertyCheckpoint: uuid('property_checkpoint'),
    organizationCheckpoint: varchar('organization_checkpoint', { length: 255 }),
    credentialActiveOrganizationId: varchar('credential_active_organization_id', {
      length: 255,
    }),
    credentialConnectionCheckpoint: uuid('credential_connection_checkpoint'),
    propertiesProcessed: bigint('properties_processed', { mode: 'number' })
      .notNull()
      .default(0),
    credentialHomesProcessed: bigint('credential_homes_processed', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    credentialConnectionsProcessed: bigint('credential_connections_processed', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    errorCount: bigint('error_count', { mode: 'number' }).notNull().default(0),
    lastErrorCode: varchar('last_error_code', { length: 64 }),
    lastReportDigestSha256: varchar('last_report_digest_sha256', { length: 64 }),
    completionDigestSha256: varchar('completion_digest_sha256', { length: 64 }),
    operatorId: varchar('operator_id', { length: 255 }),
    changeTicket: varchar('change_ticket', { length: 255 }),
    correlationId: varchar('correlation_id', { length: 255 }),
    fencedAt: timestamp('fenced_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    check(
      'data_cell_topology_cutovers_singleton_valid',
      sql`${t.singleton} = TRUE AND ${t.cutoverKey} = 'single-us-beta-v3' AND ${t.targetCellId} = 'us' AND ${t.targetPolicyVersion} = 3`,
    ),
    check(
      'data_cell_topology_cutovers_state_valid',
      sql`${t.state} IN ('open', 'fenced', 'completed') AND ${t.phase} IN ('properties', 'credential_homes', 'verify', 'completed')`,
    ),
    check(
      'data_cell_topology_cutovers_target_binding_valid',
      sql`((${t.targetProjectId} IS NULL AND ${t.targetEnvironmentId} IS NULL) OR (${t.targetProjectId} IS NOT NULL AND btrim(${t.targetProjectId}) <> '' AND ${t.targetEnvironmentId} IS NOT NULL AND btrim(${t.targetEnvironmentId}) <> '')) AND (${t.state} = 'open' OR ${t.targetProjectId} IS NOT NULL)`,
    ),
    check(
      'data_cell_topology_cutovers_checkpoint_valid',
      sql`(${t.credentialActiveOrganizationId} IS NULL AND ${t.credentialConnectionCheckpoint} IS NULL) OR (${t.credentialActiveOrganizationId} IS NOT NULL AND ${t.phase} = 'credential_homes')`,
    ),
    check(
      'data_cell_topology_cutovers_progress_valid',
      sql`${t.propertiesProcessed} >= 0 AND ${t.credentialHomesProcessed} >= 0 AND ${t.credentialConnectionsProcessed} >= 0 AND ${t.errorCount} >= 0`,
    ),
    check(
      'data_cell_topology_cutovers_digest_valid',
      sql`(${t.lastReportDigestSha256} IS NULL OR ${t.lastReportDigestSha256} ~ '^[a-f0-9]{64}$') AND (${t.completionDigestSha256} IS NULL OR ${t.completionDigestSha256} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'data_cell_topology_cutovers_lifecycle_valid',
      sql`(${t.state} = 'open' AND ${t.fencedAt} IS NULL AND ${t.completedAt} IS NULL) OR (${t.state} = 'fenced' AND ${t.fencedAt} IS NOT NULL AND ${t.completedAt} IS NULL) OR (${t.state} = 'completed' AND ${t.fencedAt} IS NOT NULL AND ${t.completedAt} IS NOT NULL AND ${t.phase} = 'completed' AND ${t.completionDigestSha256} IS NOT NULL)`,
    ),
  ],
)
