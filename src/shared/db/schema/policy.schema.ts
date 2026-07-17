// Policy state (BQC-2.2 / ADR 0032/0033) — app-owned authorization-policy tables.
//
// organization_policy / property_policy: cohort + suspension.
// organization_capability / property_capability: non-core capability allowlists.
// property_access_grant: user ↔ property access with scope/source/lifecycle —
//   the authoritative grant model BQC-2.3 wires into decisions. Tenant
//   consistency is enforced by a composite FK to properties(organization_id, id)
//   (the first explicit DB-level tenant constraint; see migration 0014).
// policy_consent: generic governed consent state (future AI opt-in; phase §9).
// policy_decision_audit: content-free decision records (identifiers/enums only;
//   no FK — audit evidence survives tenant deletion per BQC-1.7).
// policy_version: global counter bumped by every policy mutation in the same
//   statement; the snapshot store polls it for cache invalidation (mirrors the
//   permission_version pattern in dac.schema.ts).

import { sql } from 'drizzle-orm'
import {
  pgTable,
  text,
  bigint,
  uuid,
  timestamp,
  uniqueIndex,
  index,
  check,
  primaryKey,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { organization, user } from './auth'
import { properties } from './property.schema'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const organizationPolicy = pgTable('organization_policy', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  cohort: text('cohort').notNull().default('beta'),
  suspendedAt: timestamptz('suspended_at'),
  suspendedReason: text('suspended_reason'),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})

export const organizationCapability = pgTable(
  'organization_capability',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    capability: text('capability').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.capability] })],
)

export const propertyPolicy = pgTable('property_policy', {
  propertyId: uuid('property_id')
    .primaryKey()
    .references(() => properties.id, { onDelete: 'cascade' }),
  suspendedAt: timestamptz('suspended_at'),
  suspendedReason: text('suspended_reason'),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})

export const propertyCapability = pgTable(
  'property_capability',
  {
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    capability: text('capability').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.capability] })],
)

export const propertyAccessGrant = pgTable(
  'property_access_grant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    propertyId: uuid('property_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at'),
    revokedAt: timestamptz('revoked_at'),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    // Tenant consistency: the grant's org must be the property's org.
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'property_access_grant_tenant_fk',
    }).onDelete('cascade'),
    check(
      'property_access_grant_source_check',
      sql`${t.source} IN ('operator', 'migration', 'invitation')`,
    ),
    // One active grant per (org, property, user); revoked rows keep the trail.
    uniqueIndex('property_access_grant_active_unique')
      .on(t.organizationId, t.propertyId, t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
    index('property_access_grant_user_idx')
      .on(t.organizationId, t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
)

export const policyConsent = pgTable(
  'policy_consent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    purpose: text('purpose').notNull(),
    state: text('state').notNull().default('granted'),
    recordedBy: text('recorded_by'),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at'),
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [
    check(
      'policy_consent_subject_check',
      sql`${t.subjectType} IN ('organization', 'property', 'user')`,
    ),
    check('policy_consent_state_check', sql`${t.state} IN ('granted', 'revoked')`),
    uniqueIndex('policy_consent_active_unique')
      .on(t.organizationId, t.subjectType, t.subjectId, t.purpose)
      .where(sql`${t.state} = 'granted'`),
  ],
)

export const policyDecisionAudit = pgTable(
  'policy_decision_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    organizationId: text('organization_id'),
    propertyId: uuid('property_id'),
    action: text('action').notNull(),
    capability: text('capability'),
    executionKind: text('execution_kind').notNull(),
    decision: text('decision').notNull(),
    reason: text('reason').notNull(),
    policyVersion: text('policy_version').notNull(),
    correlationId: text('correlation_id'),
  },
  (t) => [
    check(
      'policy_decision_audit_actor_check',
      sql`${t.actorType} IN ('user', 'system', 'operator', 'public')`,
    ),
    check(
      'policy_decision_audit_execution_check',
      sql`${t.executionKind} IN ('interactive', 'worker', 'consumer', 'schedule', 'operator', 'public')`,
    ),
    check(
      'policy_decision_audit_decision_check',
      sql`${t.decision} IN ('allow', 'deny')`,
    ),
    index('policy_decision_audit_org_time_idx').on(t.organizationId, t.occurredAt),
  ],
)

export const policyVersion = pgTable('policy_version', {
  scope: text('scope').primaryKey(),
  version: bigint('version', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})
