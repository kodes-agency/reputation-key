// LIF-01-T15 — the backup-erasure ledger.
//
// A restore is the one operation that can undo an irreversible erasure. The
// backup that a cell is restored from was taken BEFORE the purge, so a plain
// restore silently resurrects every Organization, Property and privacy subject
// that was erased after the restore point. That is the worst outcome in the
// whole lifecycle package: data the product promised was gone comes back.
//
// The defence is this append-only ledger. Every irreversible erasure records
// WHAT was erased (subject class + tenant/property/subject identity), WHEN it
// took effect, and HOW MUCH went — never the content itself. The recovery
// fence then reads the ledger and re-applies every erasure whose effective
// time is after the restore point, before the restored cell may be declared
// verified.
//
// Two deliberate structural choices:
//
//   1. NO foreign key to `organization` or `properties`. The whole point of an
//      entry is that its subject no longer exists; a referential dependency
//      would delete the very evidence that stops resurrection.
//   2. The ledger is strictly append-only, so a legal hold cannot be recorded
//      by UPDATE-ing an entry. A hold RELEASE is therefore its own append-only
//      fact in `backup_erasure_hold_releases`, keyed by the entry it releases.

import { sql } from 'drizzle-orm'
import {
  char,
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

/**
 * What kind of subject an erasure removed.
 *
 * - `organization` — LIF-01-T14 Organization purge, one entry per context plan.
 * - `property` — LIF-01-T19 support-mediated permanent Property Erase.
 * - `privacy_subject` — LIF-01-T20 privacy erasure for one Guest or Participant.
 */
export const BACKUP_ERASURE_SUBJECT_CLASSES = [
  'organization',
  'property',
  'privacy_subject',
] as const

export type BackupErasureSubjectClass = (typeof BACKUP_ERASURE_SUBJECT_CLASSES)[number]

/**
 * The 17 lifecycle-owning contexts, in the same order as Identity's
 * `ORGANIZATION_LIFECYCLE_CONTEXTS`.
 *
 * Duplicated rather than imported for the same reason
 * `context-organization-lifecycle-receipts.schema.ts` duplicates it: `shared/**`
 * may not depend on a context's domain layer. The schema test pins the two
 * lists together so the duplicate cannot drift.
 */
export const BACKUP_ERASURE_LEDGER_CONTEXTS = [
  'activity',
  'ai',
  'badge',
  'dashboard',
  'goal',
  'guest',
  'identity',
  'inbox',
  'integration',
  'leaderboard',
  'metric',
  'notification',
  'portal',
  'property',
  'review',
  'staff',
  'team',
] as const

export type BackupErasureLedgerContext = (typeof BACKUP_ERASURE_LEDGER_CONTEXTS)[number]

const subjectClassList = BACKUP_ERASURE_SUBJECT_CLASSES.map((v) => `'${v}'`).join(', ')
const contextList = BACKUP_ERASURE_LEDGER_CONTEXTS.map((v) => `'${v}'`).join(', ')

/**
 * Append-only, content-free record of one irreversible erasure.
 *
 * Every text-shaped column is constrained to an opaque bounded token, so the
 * ledger cannot become a second copy of the data it says was destroyed.
 */
export const backupErasureLedger = pgTable(
  'backup_erasure_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectClass: varchar('subject_class', { length: 32 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    /** Present for `property` and property-scoped `privacy_subject` entries. */
    propertyId: uuid('property_id'),
    /**
     * SHA-256 of the VERIFIED subject identifier for a privacy erasure. Never
     * the email address, phone number or session pseudonym itself — the whole
     * point is that the ledger survives the data it describes.
     */
    subjectRef: char('subject_ref', { length: 64 }),
    context: varchar('context', { length: 32 }).notNull(),
    /**
     * The closure/erase/request lineage this erasure belongs to: an
     * Organization closure lineage, a Property erase authority, or a privacy
     * request. One lineage plus one revision plus one context is one entry.
     */
    closureLineageId: uuid('closure_lineage_id').notNull(),
    lifecycleRevision: integer('lifecycle_revision').notNull(),
    /**
     * When the erasure took effect. The fence compares this to the restore
     * point: an entry whose effect is AFTER the restore point is exactly an
     * erasure the restored database has undone.
     */
    effectiveErasureAt: timestamptz('effective_erasure_at').notNull(),
    erasedRowCount: integer('erased_row_count').notNull(),
    evidenceRef: varchar('evidence_ref', { length: 200 }).notNull(),
    /**
     * A documented delayed-erasure / legal-hold policy reference. While it is
     * present and unreleased the fence reports the entry as held and does NOT
     * re-apply it — program bullet 11.
     */
    holdReference: varchar('hold_reference', { length: 200 }),
    dataCellId: varchar('data_cell_id', { length: 16 }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // One entry per (lineage, revision, context, subject class): a replayed
    // purge phase must not append a second entry and inflate the counts.
    uniqueIndex('backup_erasure_ledger_lineage_unique').on(
      t.subjectClass,
      t.closureLineageId,
      t.lifecycleRevision,
      t.context,
    ),
    // The fence's read path: everything in this cell that could be resurrected.
    index('backup_erasure_ledger_replay_idx').on(t.dataCellId, t.effectiveErasureAt),
    index('backup_erasure_ledger_org_idx').on(t.organizationId, t.effectiveErasureAt),
    check(
      'backup_erasure_ledger_subject_class_valid',
      sql.raw(`"backup_erasure_ledger"."subject_class" IN (${subjectClassList})`),
    ),
    check(
      'backup_erasure_ledger_context_valid',
      sql.raw(`"backup_erasure_ledger"."context" IN (${contextList})`),
    ),
    check(
      'backup_erasure_ledger_cell_valid',
      sql`${t.dataCellId} IN ('us', 'europe', 'global')`,
    ),
    check('backup_erasure_ledger_revision_positive', sql`${t.lifecycleRevision} > 0`),
    check('backup_erasure_ledger_count_nonnegative', sql`${t.erasedRowCount} >= 0`),
    // Content-free by construction. An evidence reference, a hold reference and
    // a subject reference are opaque bounded tokens — never a message, an email
    // address, a rating or a record excerpt. This is the CHECK that forbids
    // free text.
    check(
      'backup_erasure_ledger_evidence_valid',
      sql`${t.evidenceRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'`,
    ),
    check(
      'backup_erasure_ledger_hold_valid',
      sql`${t.holdReference} IS NULL OR ${t.holdReference} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'`,
    ),
    check(
      'backup_erasure_ledger_subject_ref_valid',
      sql`${t.subjectRef} IS NULL OR ${t.subjectRef} ~ '^[a-f0-9]{64}$'`,
    ),
    // The shape of an entry must match its subject class, or the fence would
    // not know which replayer can re-apply it.
    check(
      'backup_erasure_ledger_scope_valid',
      sql`(${t.subjectClass} = 'organization' AND ${t.propertyId} IS NULL AND ${t.subjectRef} IS NULL)
        OR (${t.subjectClass} = 'property' AND ${t.propertyId} IS NOT NULL AND ${t.subjectRef} IS NULL)
        OR (${t.subjectClass} = 'privacy_subject' AND ${t.subjectRef} IS NOT NULL)`,
    ),
  ],
)

export type BackupErasureLedgerRow = typeof backupErasureLedger.$inferSelect

/**
 * Release of a documented delayed-erasure / legal hold.
 *
 * A separate table because the ledger is append-only: recording a release by
 * UPDATE-ing the entry would require a mutable ledger, and a mutable ledger is
 * a ledger an operator can quietly rewrite after a bad restore.
 */
export const backupErasureHoldReleases = pgTable(
  'backup_erasure_hold_releases',
  {
    ledgerEntryId: uuid('ledger_entry_id')
      .primaryKey()
      .references(() => backupErasureLedger.id, { onDelete: 'restrict' }),
    holdReference: varchar('hold_reference', { length: 200 }).notNull(),
    /** Counsel/policy authority that released the hold. Opaque token. */
    authorityRef: varchar('authority_ref', { length: 200 }).notNull(),
    releasedAt: timestamptz('released_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'backup_erasure_hold_releases_refs_valid',
      sql`${t.holdReference} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$' AND ${t.authorityRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'`,
    ),
  ],
)

export type BackupErasureHoldReleaseRow = typeof backupErasureHoldReleases.$inferSelect
