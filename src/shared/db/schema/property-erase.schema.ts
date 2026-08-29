// LIF-01-T19 — support-mediated permanent Property Erase authority.
//
// `properties.lifecycle_state` has declared purge_pending/purging/purged since
// BETA-1 B1.5, but nothing drove them. This is the authority that does, and it
// is deliberately NOT a tenant-facing record:
//
//   - `property.erase` is DISABLED in capability-fate.ts and is a member of
//     BLOCKED_CAPABILITIES. It stays blocked as a tenant capability.
//   - The only entry point is an operator command carrying an INDEPENDENT
//     support authorization reference. An AccountAdmin may REQUEST erasure;
//     they can never authorize it.
//
// Everything recorded here is content-free: identifiers, enums, digests and
// counts. The typed confirmation and the dependency inventory are stored as
// SHA-256 digests, never as the text an operator or admin typed.

import { sql } from 'drizzle-orm'
import {
  char,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

/**
 * The erase authority's own states.
 *
 * requested -> previewed -> confirmed -> purge_pending -> purging -> purged
 * with `cancelled` reachable from every state BEFORE purging.
 *
 * `purge_pending -> purging` is the irreversible boundary. It is enforced in
 * three independent places — the domain transition table, this CHECK's
 * companion trigger, and the job that advances it — because a single guard on
 * an irreversible operation is a single point of failure.
 */
export const PROPERTY_ERASE_STATES = [
  'requested',
  'previewed',
  'confirmed',
  'purge_pending',
  'purging',
  'purged',
  'cancelled',
] as const

const stateList = PROPERTY_ERASE_STATES.map((state) => `'${state}'`).join(', ')

export const propertyEraseAuthorities = pgTable(
  'property_erase_authorities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    /**
     * No foreign key: the authority is the evidence that this Property was
     * permanently erased, and it must outlive every row that named it.
     */
    propertyId: uuid('property_id').notNull(),
    state: varchar('state', { length: 24 }).notNull(),

    /** The AccountAdmin who asked. Requesting is not authorizing. */
    requestedByUserId: varchar('requested_by_user_id', { length: 255 }).notNull(),
    /** How that admin's identity and current authority were verified. */
    identityVerificationRef: varchar('identity_verification_ref', {
      length: 200,
    }).notNull(),
    /** The registered operator who mediated the request. */
    supportOperatorId: varchar('support_operator_id', { length: 255 }).notNull(),
    /**
     * INDEPENDENT support authorization. Not derived from the tenant session,
     * not derived from the requester, not derived from the operator identity.
     */
    supportAuthorizationRef: varchar('support_authorization_ref', {
      length: 200,
    }).notNull(),

    /** Export + retention preview shown before confirmation. Content-free. */
    retentionPreviewRef: varchar('retention_preview_ref', { length: 200 }),
    exportEvidenceRef: varchar('export_evidence_ref', { length: 200 }),
    /**
     * Monotonic revision of the dependency inventory. Confirming against a
     * stale revision is refused: the admin must confirm what they were shown.
     */
    inventoryRevision: integer('inventory_revision').notNull().default(0),
    /** SHA-256 of the canonical content-free inventory document. */
    inventoryDigest: char('inventory_digest', { length: 64 }),
    /** SHA-256 of `ERASE PROPERTY <property-id>`, never the typed text. */
    confirmationDigest: char('confirmation_digest', { length: 64 }),

    /** Grace period before purge_pending may advance to purging. */
    graceExpiresAt: timestamptz('grace_expires_at'),
    confirmedAt: timestamptz('confirmed_at'),
    purgeStartedAt: timestamptz('purge_started_at'),
    purgedAt: timestamptz('purged_at'),
    cancelledAt: timestamptz('cancelled_at'),
    /** Content-free cancellation reason code — never free text. */
    cancelReasonCode: varchar('cancel_reason_code', { length: 64 }),

    evidenceRef: varchar('evidence_ref', { length: 200 }).notNull(),
    correlationId: varchar('correlation_id', { length: 255 }).notNull(),
    requestedAt: timestamptz('requested_at').notNull(),
    stateChangedAt: timestamptz('state_changed_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // At most one live authority per Property. Two concurrent erasures of the
    // same Property would each believe they owned the irreversible boundary.
    uniqueIndex('property_erase_authorities_live_unique')
      .on(t.propertyId)
      .where(sql`state NOT IN ('purged', 'cancelled')`),
    index('property_erase_authorities_state_idx').on(t.state, t.stateChangedAt),
    index('property_erase_authorities_org_idx').on(t.organizationId, t.propertyId),
    check(
      'property_erase_authorities_state_valid',
      sql.raw(`"property_erase_authorities"."state" IN (${stateList})`),
    ),
    check(
      'property_erase_authorities_refs_valid',
      sql`${t.identityVerificationRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
        AND ${t.supportAuthorizationRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
        AND ${t.evidenceRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
        AND (${t.retentionPreviewRef} IS NULL OR ${t.retentionPreviewRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
        AND (${t.exportEvidenceRef} IS NULL OR ${t.exportEvidenceRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
        AND (${t.cancelReasonCode} IS NULL OR ${t.cancelReasonCode} ~ '^[a-z][a-z0-9_]{0,63}$')`,
    ),
    check(
      'property_erase_authorities_digests_valid',
      sql`(${t.inventoryDigest} IS NULL OR ${t.inventoryDigest} ~ '^[a-f0-9]{64}$')
        AND (${t.confirmationDigest} IS NULL OR ${t.confirmationDigest} ~ '^[a-f0-9]{64}$')`,
    ),
    check('property_erase_authorities_revision_valid', sql`${t.inventoryRevision} >= 0`),
    // Confirmation is what unlocks the destructive path, so it may not be
    // implied: reaching `confirmed` or beyond requires the typed confirmation
    // digest, the inventory it was shown against, and the retention preview.
    check(
      'property_erase_authorities_confirmation_complete',
      sql`${t.state} IN ('requested', 'previewed', 'cancelled')
        OR (${t.confirmationDigest} IS NOT NULL AND ${t.inventoryDigest} IS NOT NULL
          AND ${t.retentionPreviewRef} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL)`,
    ),
    check(
      'property_erase_authorities_terminal_valid',
      sql`(${t.state} = 'purged') = (${t.purgedAt} IS NOT NULL)
        AND (${t.state} = 'cancelled') = (${t.cancelledAt} IS NOT NULL)
        AND (${t.state} NOT IN ('purging', 'purged') OR ${t.purgeStartedAt} IS NOT NULL)`,
    ),
  ],
)

export type PropertyEraseAuthorityRow = typeof propertyEraseAuthorities.$inferSelect

/**
 * One append-only receipt per owning context, per erase authority.
 *
 * This is the replay ledger: an interrupted purge resumes from the receipts
 * already written rather than re-running contexts that already answered. A
 * `no_data` receipt is still evidence — an omitted contributor would make a
 * partial erasure look complete.
 */
export const propertyEraseContextReceipts = pgTable(
  'property_erase_context_receipts',
  {
    authorityId: uuid('authority_id')
      .notNull()
      .references(() => propertyEraseAuthorities.id, { onDelete: 'restrict' }),
    context: varchar('context', { length: 32 }).notNull(),
    phase: varchar('phase', { length: 24 }).notNull(),
    outcome: varchar('outcome', { length: 16 }).notNull(),
    erasedRowCount: integer('erased_row_count').notNull(),
    evidenceRef: varchar('evidence_ref', { length: 200 }).notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.authorityId, t.context, t.phase],
      name: 'property_erase_context_receipts_pk',
    }),
    index('property_erase_context_receipts_authority_idx').on(t.authorityId, t.phase),
    check(
      'property_erase_context_receipts_phase_valid',
      sql`${t.phase} IN ('inventory', 'purge')`,
    ),
    check(
      'property_erase_context_receipts_outcome_valid',
      sql`${t.outcome} IN ('complete', 'no_data')`,
    ),
    check('property_erase_context_receipts_count_valid', sql`${t.erasedRowCount} >= 0`),
    check(
      'property_erase_context_receipts_evidence_valid',
      sql`${t.evidenceRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'`,
    ),
  ],
)

export type PropertyEraseContextReceiptRow =
  typeof propertyEraseContextReceipts.$inferSelect
