// Application-owned identity governance state.
//
// Better Auth owns users, sessions, memberships, organizations, and
// invitations. This table is deliberately app-owned: it is the closed-beta
// authority that binds one login to one Organization independently of the
// mutable session activeOrganizationId field.

import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'

export const userOrganizationBindings = pgTable(
  'user_organization_bindings',
  {
    // One row per user makes two simultaneous active Organization bindings
    // unrepresentable. No FK crosses into the Better Auth-owned schema track.
    userId: text('user_id').primaryKey(),
    organizationId: text('organization_id'),
    state: text('state').notNull().default('active'),
    source: text('source').notNull(),
    invitationId: text('invitation_id'),
    version: integer('version').notNull().default(1),
    resolutionReason: text('resolution_reason'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index('user_organization_bindings_org_state_idx').on(t.organizationId, t.state),
    check(
      'user_organization_bindings_state_valid',
      sql`${t.state} IN ('active', 'support_resolution', 'released')`,
    ),
    check(
      'user_organization_bindings_source_valid',
      sql`${t.source} IN ('invitation', 'operator', 'backfill')`,
    ),
    check('user_organization_bindings_version_positive', sql`${t.version} > 0`),
    check(
      'user_organization_bindings_state_shape',
      sql`(
        (${t.state} = 'active' AND ${t.organizationId} IS NOT NULL AND ${t.releasedAt} IS NULL)
        OR (${t.state} = 'support_resolution' AND ${t.releasedAt} IS NULL)
        OR (${t.state} = 'released' AND ${t.releasedAt} IS NOT NULL)
      )`,
    ),
  ],
)

/**
 * Rolling contract authority for the invitation fact privacy migration.
 *
 * Version 1 is the expand shape understood by the pre-migration dispatcher;
 * its `email` key contains only the structural sentinel `[redacted]`. Version
 * 2 removes the key. A database trigger owns issuance during the rolling
 * window so old and new application replicas cannot race the cutover.
 */
export const identityInvitationFactContract = pgTable(
  'identity_invitation_fact_contract',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    issuanceVersion: smallint('issuance_version').notNull().default(1),
    generation: bigint('generation', { mode: 'number' }).notNull().default(1),
    switchedAt: timestamp('switched_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    operatorId: varchar('operator_id', { length: 255 }),
    reason: varchar('reason', { length: 500 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    check('identity_invitation_fact_contract_singleton', sql`${t.singleton} = true`),
    check(
      'identity_invitation_fact_contract_version_valid',
      sql`${t.issuanceVersion} IN (1, 2)`,
    ),
    check(
      'identity_invitation_fact_contract_generation_positive',
      sql`${t.generation} >= 1`,
    ),
    check(
      'identity_invitation_fact_contract_switch_shape',
      sql`(${t.issuanceVersion} = 1 AND ${t.switchedAt} IS NULL AND ${t.verifiedAt} IS NULL)
          OR (${t.issuanceVersion} = 2 AND ${t.switchedAt} IS NOT NULL)`,
    ),
    check(
      'identity_invitation_fact_contract_operator_shape',
      sql`(${t.operatorId} IS NULL) = (${t.reason} IS NULL)`,
    ),
  ],
)
