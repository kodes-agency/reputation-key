// Application-owned identity governance state.

import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  pgTable,
  smallint,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'

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
