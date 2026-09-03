import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'

/**
 * Content-free recovery authority for invitation-bound account creation.
 *
 * Better Auth and invitation acceptance commit in separate transactions. The
 * row records the exact, preallocated auth user ID before provider work starts,
 * which lets recovery distinguish this interrupted attempt from every other
 * account without persisting a password, name, email, or session credential.
 */
export const invitedRegistrationAttempts = pgTable(
  'invited_registration_attempts',
  {
    id: uuid('id').primaryKey(),
    invitationId: text('invitation_id').notNull(),
    organizationId: text('organization_id').notNull(),
    expectedUserId: text('expected_user_id').notNull(),
    expectedCredentialAccountId: text('expected_credential_account_id').notNull(),
    expectedInitialSessionId: text('expected_initial_session_id').notNull(),
    attemptOrdinal: integer('attempt_ordinal').notNull(),
    state: text('state').notNull().default('prepared'),
    requestCount: integer('request_count').notNull().default(1),
    providerObservedAt: timestamp('provider_observed_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    compensatedAt: timestamp('compensated_at', { withTimezone: true }),
    manualReviewAt: timestamp('manual_review_at', { withTimezone: true }),
    nextRecoveryAt: timestamp('next_recovery_at', { withTimezone: true }),
    leaseOwner: varchar('lease_owner', { length: 128 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    lastFailureCode: varchar('last_failure_code', { length: 64 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('invited_registration_expected_user_unique').on(t.expectedUserId),
    uniqueIndex('invited_registration_expected_account_unique').on(
      t.expectedCredentialAccountId,
    ),
    uniqueIndex('invited_registration_expected_session_unique').on(
      t.expectedInitialSessionId,
    ),
    uniqueIndex('invited_registration_invitation_ordinal_unique').on(
      t.invitationId,
      t.attemptOrdinal,
    ),
    uniqueIndex('invited_registration_one_unresolved_per_invitation')
      .on(t.invitationId)
      .where(sql`${t.state} IN ('prepared', 'manual_review')`),
    index('invited_registration_recovery_due_idx')
      .on(t.nextRecoveryAt, t.createdAt)
      .where(sql`${t.state} = 'prepared'`),
    check(
      'invited_registration_state_valid',
      sql`${t.state} IN ('prepared', 'accepted', 'compensated', 'manual_review')`,
    ),
    check('invited_registration_attempt_ordinal_positive', sql`${t.attemptOrdinal} > 0`),
    check('invited_registration_request_count_positive', sql`${t.requestCount} > 0`),
    check(
      'invited_registration_lease_pair',
      sql`(${t.leaseOwner} IS NULL) = (${t.leaseExpiresAt} IS NULL)`,
    ),
    check(
      'invited_registration_terminal_shape',
      sql`(
        ${t.state} = 'prepared'
        AND ${t.acceptedAt} IS NULL
        AND ${t.compensatedAt} IS NULL
        AND ${t.manualReviewAt} IS NULL
        AND ${t.nextRecoveryAt} IS NOT NULL
      ) OR (
        ${t.state} = 'accepted'
        AND ${t.acceptedAt} IS NOT NULL
        AND ${t.compensatedAt} IS NULL
        AND ${t.manualReviewAt} IS NULL
        AND ${t.nextRecoveryAt} IS NULL
        AND ${t.leaseOwner} IS NULL
      ) OR (
        ${t.state} = 'compensated'
        AND ${t.acceptedAt} IS NULL
        AND ${t.compensatedAt} IS NOT NULL
        AND ${t.manualReviewAt} IS NULL
        AND ${t.nextRecoveryAt} IS NULL
        AND ${t.leaseOwner} IS NULL
      ) OR (
        ${t.state} = 'manual_review'
        AND ${t.acceptedAt} IS NULL
        AND ${t.compensatedAt} IS NULL
        AND ${t.manualReviewAt} IS NOT NULL
        AND ${t.nextRecoveryAt} IS NULL
        AND ${t.leaseOwner} IS NULL
      )`,
    ),
  ],
)

export type InvitedRegistrationAttemptRow =
  typeof invitedRegistrationAttempts.$inferSelect
