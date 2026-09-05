// Shared, context-keyed Organization lifecycle receipts (LIF-01).
//
// Program bullet 5 requires EVERY owning context to supply an idempotent,
// content-free purge/scrub receipt. `identity_organization_lifecycle_receipts`
// proved the shape; duplicating that table and its guards sixteen more times
// would be unreviewable, so the other contexts share one table keyed by
// context. The composite primary key still gives each context its own
// idempotency identity per (closureLineageId, lifecycleRevision, phase).
//
// Like the Identity table it deliberately has NO foreign key to organization:
// closure evidence must survive removal of the Better Auth Organization row.

import { sql, desc } from 'drizzle-orm'
import {
  char,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

/**
 * The 14 lifecycle-owning contexts, in the same order as Identity's
 * `ORGANIZATION_LIFECYCLE_CONTEXTS`.
 *
 * The list is duplicated here rather than imported because `shared/**` may not
 * depend on a context's domain layer (see src/contexts/CONTEXT.md dependency
 * rules). `organization-lifecycle-receipt-store.test.ts` asserts the two lists
 * are identical, so the duplication cannot drift silently.
 */
export const CONTEXT_LIFECYCLE_RECEIPT_CONTEXTS = [
  'activity',
  'ai',
  'dashboard',
  'goal',
  'guest',
  'identity',
  'inbox',
  'integration',
  'metric',
  'notification',
  'portal',
  'property',
  'review',
  'staff',
] as const

export type ContextLifecycleReceiptContext =
  (typeof CONTEXT_LIFECYCLE_RECEIPT_CONTEXTS)[number]

export const CONTEXT_LIFECYCLE_RECEIPT_PHASES = [
  'closing',
  'purge_readiness',
  'purge',
] as const

export type ContextLifecycleReceiptPhase =
  (typeof CONTEXT_LIFECYCLE_RECEIPT_PHASES)[number]

export const CONTEXT_LIFECYCLE_RECEIPT_OUTCOMES = ['complete', 'no_data'] as const

export type ContextLifecycleReceiptOutcome =
  (typeof CONTEXT_LIFECYCLE_RECEIPT_OUTCOMES)[number]

const contextList = CONTEXT_LIFECYCLE_RECEIPT_CONTEXTS.map(
  (context) => `'${context}'`,
).join(', ')

export const contextOrganizationLifecycleReceipts = pgTable(
  'context_organization_lifecycle_receipts',
  {
    context: text('context').notNull(),
    organizationId: text('organization_id').notNull(),
    closureLineageId: uuid('closure_lineage_id').notNull(),
    lifecycleRevision: integer('lifecycle_revision').notNull(),
    phase: text('phase').notNull(),
    requestFingerprint: char('request_fingerprint', { length: 64 }).notNull(),
    outcome: text('outcome').notNull(),
    evidenceRef: varchar('evidence_ref', { length: 200 }).notNull(),
    recoverableUntil: timestamptz('recoverable_until').notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.context, t.closureLineageId, t.lifecycleRevision, t.phase],
      name: 'context_organization_lifecycle_receipts_pk',
    }),
    check(
      'context_organization_lifecycle_receipts_revision_positive',
      sql`${t.lifecycleRevision} > 0`,
    ),
    check(
      'context_organization_lifecycle_receipts_context_valid',
      sql.raw(`"context_organization_lifecycle_receipts"."context" IN (${contextList})`),
    ),
    check(
      'context_organization_lifecycle_receipts_phase_valid',
      sql`${t.phase} IN ('closing', 'purge_readiness', 'purge')`,
    ),
    check(
      'context_organization_lifecycle_receipts_outcome_valid',
      sql`${t.outcome} IN ('complete', 'no_data')`,
    ),
    check(
      'context_organization_lifecycle_receipts_fingerprint_valid',
      sql`${t.requestFingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
    // Content-free by construction: an evidence reference is an opaque,
    // bounded token, never a message, email address, or record excerpt.
    check(
      'context_organization_lifecycle_receipts_evidence_valid',
      sql`${t.evidenceRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'`,
    ),
    index('context_organization_lifecycle_receipts_org_time_idx').on(
      t.organizationId,
      desc(t.occurredAt),
    ),
    index('context_organization_lifecycle_receipts_lineage_idx').on(
      t.closureLineageId,
      t.lifecycleRevision,
      t.phase,
    ),
  ],
)
