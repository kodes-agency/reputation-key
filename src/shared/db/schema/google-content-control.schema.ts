import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })
const generation = (name: string) => bigint(name, { mode: 'number' })

export const googleContentCapabilityEnum = pgEnum('google_content_capability', [
  'property.import_gbp_v2',
  'property.read_gbp_performance',
  'property.connect_gbp',
  'property.publish_reply',
])
export const authorizationExecutionPermitStateEnum = pgEnum(
  'authorization_execution_permit_state',
  ['admitted', 'started', 'completed', 'fenced'],
)
export const googleCredentialSourceKindEnum = pgEnum('google_credential_source_kind', [
  'refresh',
  'reauth',
  'reconnect',
])
export const googleCredentialSourceStateEnum = pgEnum('google_credential_source_state', [
  'registered',
  'provider_started',
  'terminal',
  'provider_outcome_ambiguous',
  'provider_reset_terminal',
])
export const googleSubjectAuthorityGuardStateEnum = pgEnum(
  'google_subject_authority_guard_state',
  [
    'open',
    'source_active',
    'cleanup_pending',
    'drained',
    'provider_reset_required',
    'ambiguous',
    'provider_reset_terminal',
  ],
)
export const credentialRevokePermitStateEnum = pgEnum('credential_revoke_permit_state', [
  'dormant',
  'active',
  'dispatching',
  'consumed_no_revoke',
  'confirmed_not_sent',
  'confirmed_revoked',
  'cleanup_ambiguous',
  'provider_reset_confirmed',
])

export const capabilityExecutionControl = pgTable(
  'capability_execution_control',
  {
    capability: googleContentCapabilityEnum('capability').primaryKey(),
    denied: boolean('denied').notNull().default(true),
    emergencyKillVersion: generation('emergency_kill_version').notNull().default(0),
    deniedAt: timestamptz('denied_at'),
    drainedAt: timestamptz('drained_at'),
    cleanupDrainedAt: timestamptz('cleanup_drained_at'),
    operatorId: varchar('operator_id', { length: 255 }),
    reason: varchar('reason', { length: 500 }),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    check(
      'capability_execution_control_denied_check',
      sql`(${table.denied} AND ${table.deniedAt} IS NOT NULL) OR (NOT ${table.denied} AND ${table.deniedAt} IS NULL AND ${table.drainedAt} IS NULL AND ${table.cleanupDrainedAt} IS NULL)`,
    ),
  ],
)

export const authorizationExecutionPermits = pgTable(
  'authorization_execution_permits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scopeSchemaVersion: integer('scope_schema_version').notNull().default(1),
    capability: googleContentCapabilityEnum('capability').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id'),
    connectionId: uuid('connection_id'),
    initiatorUserId: varchar('initiator_user_id', { length: 255 }),
    operationKey: varchar('operation_key', { length: 128 }).notNull(),
    routeKey: varchar('route_key', { length: 160 }).notNull(),
    routeCatalogVersion: varchar('route_catalog_version', { length: 64 }).notNull(),
    quotaPolicyId: varchar('quota_policy_id', { length: 128 }).notNull(),
    // WP2.2: six ceremony columns used to sit here — `policy_version` and
    // `emergency_kill_version` (a global cache generation and its sibling
    // counter, compared to detect a write that happened somewhere else),
    // `approval_binding_id` (a restrict-FK to the approval bundle),
    // `permit_generation`, `start_vector_mode` and `commit_vector_mode`. The SQL
    // that read them went in step 1; these are the columns it read. What
    // actually protects a permit survives: the authorization vector below, the
    // connection's own liveness, `organization_capability`, `member.role` and
    // `permission_version`.
    authorizationVector: jsonb('authorization_vector')
      .$type<Readonly<Record<string, string | number | boolean | null>>>()
      .notNull(),
    state: authorizationExecutionPermitStateEnum('state').notNull(),
    admittedAt: timestamptz('admitted_at').notNull(),
    startDeadlineAt: timestamptz('start_deadline_at').notNull(),
    startedAt: timestamptz('started_at'),
    operationDeadlineAt: timestamptz('operation_deadline_at'),
    completedAt: timestamptz('completed_at'),
    fencedAt: timestamptz('fenced_at'),
    correlationId: varchar('correlation_id', { length: 255 }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('authorization_execution_permits_active_idx').on(
      table.capability,
      table.state,
      table.startDeadlineAt,
      table.operationDeadlineAt,
    ),
    index('authorization_execution_permits_created_at_idx').on(table.createdAt),
    index('authorization_execution_permits_scope_idx').on(
      table.organizationId,
      table.propertyId,
      table.connectionId,
    ),
    check(
      'authorization_execution_permits_start_window_check',
      sql`${table.startDeadlineAt} > ${table.admittedAt}`,
    ),
    check(
      'authorization_execution_permits_operation_window_check',
      sql`${table.operationDeadlineAt} IS NULL OR (${table.startedAt} IS NOT NULL AND ${table.operationDeadlineAt} > ${table.startedAt})`,
    ),
    check(
      'authorization_execution_permits_state_check',
      sql`(${table.state} = 'admitted' AND ${table.startedAt} IS NULL AND ${table.operationDeadlineAt} IS NULL AND ${table.completedAt} IS NULL) OR (${table.state} = 'started' AND ${table.startedAt} IS NOT NULL AND ${table.operationDeadlineAt} IS NOT NULL AND ${table.completedAt} IS NULL) OR (${table.state} = 'completed' AND ${table.startedAt} IS NOT NULL AND ${table.operationDeadlineAt} IS NOT NULL AND ${table.completedAt} IS NOT NULL) OR (${table.state} = 'fenced' AND ${table.fencedAt} IS NOT NULL)`,
    ),
  ],
)
