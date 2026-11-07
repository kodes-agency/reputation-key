import { sql } from 'drizzle-orm'
import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core'

/** Feed owns this content-free authority. Retention uses occurrence time, never copy time. */
export const AUDIT_EVENT_RETENTION_DAYS = 365

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    propertyId: text('property_id'),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    outcome: text('outcome').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    sourceKind: text('source_kind').notNull(),
    sourceId: text('source_id').notNull(),
    sourceEventType: text('source_event_type'),
    sourceEventVersion: integer('source_event_version'),
    sourceContext: text('source_context'),
    sourceAggregateId: text('source_aggregate_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('audit_events_source_uniq').on(
      table.organizationId,
      table.sourceKind,
      table.sourceId,
    ),
    index('audit_events_org_time_idx').on(
      table.organizationId,
      table.occurredAt,
      table.id,
    ),
    index('audit_events_retention_idx').on(table.occurredAt, table.id),
    check(
      'audit_events_organization_id_valid',
      sql`${table.organizationId} ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'`,
    ),
    check(
      'audit_events_property_id_valid',
      sql`${table.propertyId} ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'`,
    ),
    check(
      'audit_events_actor_id_valid',
      sql`${table.actorId} ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'`,
    ),
    check(
      'audit_events_resource_id_valid',
      sql`${table.resourceId} ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'`,
    ),
    check(
      'audit_events_source_id_valid',
      sql`${table.sourceId} ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'`,
    ),
    check(
      'audit_events_source_aggregate_id_valid',
      sql`${table.sourceAggregateId} ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'`,
    ),
    check(
      'audit_events_action_valid',
      sql`${table.action} ~ '^[a-z][a-z0-9_.:-]{0,79}$'`,
    ),
    check(
      'audit_events_resource_type_valid',
      sql`${table.resourceType} ~ '^[a-z][a-z0-9_.:-]{0,39}$'`,
    ),
    check(
      'audit_events_source_event_type_valid',
      sql`${table.sourceEventType} ~ '^[a-z][a-z0-9_.:-]{0,127}$'`,
    ),
    check(
      'audit_events_source_context_valid',
      sql`${table.sourceContext} ~ '^[a-z][a-z0-9_.:-]{0,127}$'`,
    ),
    check(
      'audit_events_actor_type_valid',
      sql`${table.actorType} ~ '^(user|system|operator|service|public)$'`,
    ),
    check(
      'audit_events_actor_attribution_valid',
      sql`${table.actorType} !~ '^(system|public)$' OR ${table.actorId} IS NULL`,
    ),
    check(
      'audit_events_outcome_valid',
      sql`${table.outcome} ~ '^(succeeded|denied|failed)$'`,
    ),
    check(
      'audit_events_source_valid',
      sql`(${table.sourceKind} = 'domain_fact' AND ${table.sourceEventType} IS NOT NULL AND ${table.sourceEventVersion} IS NOT NULL AND ${table.sourceEventVersion} >= 1 AND ${table.sourceContext} IS NOT NULL AND ${table.sourceAggregateId} IS NOT NULL) OR (${table.sourceKind} ~ '^(policy_decision|interactive_command|worker_command|operator_command|history_access|history_lifecycle)$' AND ${table.sourceEventType} IS NULL AND ${table.sourceEventVersion} IS NULL AND ${table.sourceContext} IS NULL AND ${table.sourceAggregateId} IS NULL)`,
    ),
  ],
)

export type AuditEventRow = typeof auditEvents.$inferSelect
