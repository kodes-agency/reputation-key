// LIF-01-T15 — the backup-erasure ledger and the restore resurrection fence.
//
// Read this file as two halves.
//
// The FIRST half is the ledger: an append-only record of every irreversible
// erasure, written in the SAME transaction that performs the erasure. If the
// erasure commits, the entry commits; if the erasure rolls back, so does the
// entry. Anything looser and the ledger is a second source of truth that can
// disagree with reality.
//
// The SECOND half is the fence. A restored cell has been rolled back in time,
// so every erasure whose effect is AFTER the restore point has been undone —
// the purged Organization is back, the erased Property is back, the privacy
// subject's feedback is back. The fence re-applies those erasures before the
// cell may be declared verified, and it is FAIL-CLOSED: an entry it could not
// re-apply means the restored cell is NOT verified. A partially re-erased
// restore must never be opened for traffic.
//
// Documented delayed-erasure / legal-hold policy (program bullet 11) is the one
// exception, and it is an explicit deferral rather than a silent skip: a held
// entry is reported as held, is not re-applied, and stops being held only when
// a counsel-authorised release is appended.

import { sql } from 'drizzle-orm'
import {
  BACKUP_ERASURE_LEDGER_CONTEXTS,
  BACKUP_ERASURE_SUBJECT_CLASSES,
  type BackupErasureLedgerContext,
  type BackupErasureSubjectClass,
} from '#/shared/db/schema/backup-erasure-ledger.schema'
import {
  appendBackupErasureHoldReleaseEvent,
  readBackupErasureHoldReleaseEvents,
} from './organization-lifecycle-receipt-store'
import type { Tx } from '#/shared/outbox/commit'

export type { BackupErasureLedgerContext, BackupErasureSubjectClass }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const CONTENT_FREE_REF = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u
const SHA256 = /^[0-9a-f]{64}$/u

/** One irreversible erasure, as it is appended. */
export type BackupErasureLedgerAppend = Readonly<{
  subjectClass: BackupErasureSubjectClass
  organizationId: string
  propertyId?: string
  /** SHA-256 of the verified subject identifier; privacy erasures only. */
  subjectRef?: string
  context: BackupErasureLedgerContext
  closureLineageId: string
  lifecycleRevision: number
  effectiveErasureAt: Date
  erasedRowCount: number
  evidenceRef: string
  /** Documented delayed-erasure / legal-hold policy reference. */
  holdReference?: string
}>

/** A ledger entry as the fence reads it, with its hold state resolved. */
export type BackupErasureLedgerEntry = BackupErasureLedgerAppend &
  Readonly<{
    id: string
    /** Set once a counsel-authorised release has been appended. */
    holdReleasedAt?: Date
  }>

export const BACKUP_ERASURE_LEDGER_CONTENT_ERROR =
  'backup erasure ledger entries must be content-free'

function assertContentFreeRef(value: string, what: string): void {
  if (!CONTENT_FREE_REF.test(value)) {
    throw new Error(`${BACKUP_ERASURE_LEDGER_CONTENT_ERROR}: ${what}`)
  }
}

/** Every reference the entry carries is an opaque token, never content. */
function assertReferenceShapes(entry: BackupErasureLedgerAppend): void {
  assertContentFreeRef(entry.evidenceRef, 'evidenceRef')
  if (entry.holdReference !== undefined) {
    assertContentFreeRef(entry.holdReference, 'holdReference')
  }
  if (entry.subjectRef !== undefined && !SHA256.test(entry.subjectRef)) {
    throw new Error(`${BACKUP_ERASURE_LEDGER_CONTENT_ERROR}: subjectRef`)
  }
  if (entry.propertyId !== undefined && !UUID.test(entry.propertyId)) {
    throw new Error('backup erasure property identity must be a UUID')
  }
}

/**
 * The subject shape must match the class, or the fence cannot tell which
 * replayer is allowed to re-apply the entry.
 */
function assertSubjectShapeMatchesClass(entry: BackupErasureLedgerAppend): void {
  if (entry.subjectClass === 'organization' && (entry.propertyId || entry.subjectRef)) {
    throw new Error('an Organization erasure is not scoped to a Property or subject')
  }
  if (entry.subjectClass === 'property' && (!entry.propertyId || entry.subjectRef)) {
    throw new Error('a Property erasure names exactly one Property and no subject')
  }
  if (entry.subjectClass === 'privacy_subject' && !entry.subjectRef) {
    throw new Error('a privacy erasure names exactly one verified subject')
  }
}

/**
 * Validate an append before it reaches the database.
 *
 * The CHECK constraints already refuse a malformed row; this exists so the
 * caller fails at the point of the mistake with a reviewable message, and so
 * unit tests can prove the content-free rule without a database.
 */
export function validateBackupErasureLedgerAppend(
  entry: BackupErasureLedgerAppend,
): void {
  if (!BACKUP_ERASURE_SUBJECT_CLASSES.includes(entry.subjectClass)) {
    throw new Error('backup erasure subject class is unknown')
  }
  if (!BACKUP_ERASURE_LEDGER_CONTEXTS.includes(entry.context)) {
    throw new Error('backup erasure context is not a lifecycle-owning context')
  }
  if (entry.organizationId.trim() === '' || entry.organizationId.length > 255) {
    throw new Error('backup erasure organization identity is required')
  }
  if (!UUID.test(entry.closureLineageId)) {
    throw new Error('backup erasure lineage must be a UUID')
  }
  if (
    !Number.isSafeInteger(entry.lifecycleRevision) ||
    entry.lifecycleRevision < 1 ||
    !Number.isSafeInteger(entry.erasedRowCount) ||
    entry.erasedRowCount < 0
  ) {
    throw new Error('backup erasure revision and row count must be bounded integers')
  }
  if (Number.isNaN(entry.effectiveErasureAt.getTime())) {
    throw new Error('backup erasure effective instant must be valid')
  }
  assertReferenceShapes(entry)
  assertSubjectShapeMatchesClass(entry)
}

/**
 * Append one erasure to the ledger, in the erasure's own transaction.
 *
 * Idempotent by lineage: replaying the same purge phase re-appends nothing and
 * returns the existing entry id, so a retried purge cannot inflate the counts
 * the fence later replays.
 */
export async function appendBackupErasureLedgerEntry(
  tx: Tx,
  entry: BackupErasureLedgerAppend,
): Promise<string> {
  validateBackupErasureLedgerAppend(entry)
  const inserted = await tx.execute(sql`
    INSERT INTO backup_erasure_ledger (
      subject_class, organization_id, property_id, subject_ref, context,
      closure_lineage_id, lifecycle_revision, effective_erasure_at,
      erased_row_count, evidence_ref, hold_reference
    ) VALUES (
      ${entry.subjectClass}, ${entry.organizationId},
      ${entry.propertyId ?? null}, ${entry.subjectRef ?? null}, ${entry.context},
      ${entry.closureLineageId}::uuid, ${entry.lifecycleRevision},
      ${entry.effectiveErasureAt.toISOString()}::timestamptz,
      ${entry.erasedRowCount}, ${entry.evidenceRef},
      ${entry.holdReference ?? null}
    )
    ON CONFLICT (subject_class, closure_lineage_id, lifecycle_revision, context)
    DO NOTHING
    RETURNING id
  `)
  const insertedId = (inserted.rows[0] as { id: string } | undefined)?.id
  if (insertedId) return insertedId
  const existing = await tx.execute(sql`
    SELECT id FROM backup_erasure_ledger
    WHERE subject_class = ${entry.subjectClass}
      AND closure_lineage_id = ${entry.closureLineageId}::uuid
      AND lifecycle_revision = ${entry.lifecycleRevision}
      AND context = ${entry.context}
  `)
  const existingId = (existing.rows[0] as { id: string } | undefined)?.id
  if (!existingId) throw new Error('backup erasure ledger append did not persist')
  return existingId
}

/** Append the counsel-authorised release of a documented legal hold. */
export async function releaseBackupErasureHold(
  tx: Tx,
  release: Readonly<{
    ledgerEntryId: string
    holdReference: string
    authorityRef: string
    releasedAt: Date
  }>,
): Promise<void> {
  assertContentFreeRef(release.holdReference, 'holdReference')
  assertContentFreeRef(release.authorityRef, 'authorityRef')
  await appendBackupErasureHoldReleaseEvent(tx, release)
}

type LedgerRow = Readonly<{
  id: string
  subject_class: BackupErasureSubjectClass
  organization_id: string
  property_id: string | null
  subject_ref: string | null
  context: BackupErasureLedgerContext
  closure_lineage_id: string
  lifecycle_revision: number
  effective_erasure_at: string | Date
  erased_row_count: number
  evidence_ref: string
  hold_reference: string | null
}>

function entryFromRow(
  row: LedgerRow,
  holdReleasedAt: Date | undefined,
): BackupErasureLedgerEntry {
  return {
    id: row.id,
    subjectClass: row.subject_class,
    organizationId: row.organization_id,
    ...(row.property_id ? { propertyId: row.property_id } : {}),
    ...(row.subject_ref ? { subjectRef: row.subject_ref } : {}),
    context: row.context,
    closureLineageId: row.closure_lineage_id,
    lifecycleRevision: Number(row.lifecycle_revision),
    effectiveErasureAt: new Date(row.effective_erasure_at),
    erasedRowCount: Number(row.erased_row_count),
    evidenceRef: row.evidence_ref,
    ...(row.hold_reference ? { holdReference: row.hold_reference } : {}),
    ...(holdReleasedAt ? { holdReleasedAt } : {}),
  }
}

/** Every ledger entry, oldest effect first. */
export async function readBackupErasureLedger(
  tx: Tx,
): Promise<readonly BackupErasureLedgerEntry[]> {
  const releases = await readBackupErasureHoldReleaseEvents(tx)
  const releasedAtByEntryId = new Map(
    releases.map((release) => [release.ledgerEntryId, release.releasedAt]),
  )
  const result = await tx.execute(sql`
    SELECT l.*
    FROM backup_erasure_ledger l
    ORDER BY l.effective_erasure_at ASC, l.id ASC
  `)
  return (result.rows as unknown as LedgerRow[]).map((row) =>
    entryFromRow(row, releasedAtByEntryId.get(row.id)),
  )
}

// ── The restore resurrection fence ───────────────────────────────────

export type BackupErasureReplayDisposition =
  /** The restore already post-dates the erasure — nothing was resurrected. */
  | 'already_erased'
  /** The restore predates the erasure — the data is back and must go again. */
  | 'replay_required'
  /** Held under documented delayed-erasure/legal-hold policy. Not re-applied. */
  | 'held'

export type BackupErasureReplayPlanItem = Readonly<{
  entry: BackupErasureLedgerEntry
  disposition: BackupErasureReplayDisposition
}>

/**
 * Decide, per entry, what a restore to `restorePointAt` did to it.
 *
 * PURE and convergent. An erasure that took effect at or before the restore
 * point is already baked into the restored bytes, so replaying it would be
 * double-counting; only erasures whose effect is strictly after the restore
 * point were undone.
 */
export function planBackupErasureReplay(
  entries: readonly BackupErasureLedgerEntry[],
  restorePointAt: Date,
): readonly BackupErasureReplayPlanItem[] {
  if (Number.isNaN(restorePointAt.getTime())) {
    throw new Error('restore point must be a valid instant')
  }
  const restorePoint = restorePointAt.getTime()
  return entries.map((entry) => {
    if (entry.effectiveErasureAt.getTime() <= restorePoint) {
      return { entry, disposition: 'already_erased' as const }
    }
    if (entry.holdReference !== undefined && entry.holdReleasedAt === undefined) {
      return { entry, disposition: 'held' as const }
    }
    return { entry, disposition: 'replay_required' as const }
  })
}

/**
 * Re-applies one class of erasure in a restored cell.
 *
 * A replayer is registered per (context, subjectClass). The fence deliberately
 * has no default: an entry with no registered replayer is UNREPLAYED, and an
 * unreplayed entry fails the restore closed rather than being skipped.
 */
export type BackupErasureReplayer = Readonly<{
  context: BackupErasureLedgerContext
  subjectClass: BackupErasureSubjectClass
  /** Re-erase the entry's subject; returns the number of rows removed. */
  reErase(tx: Tx, entry: BackupErasureLedgerEntry): Promise<number>
}>

/** Content-free replay counts, reported alongside `RecoveryFenceCounts`. */
export type BackupErasureReplayCounts = Readonly<{
  ledgerEntriesConsidered: number
  ledgerEntriesAlreadyErased: number
  ledgerEntriesReapplied: number
  ledgerEntriesHeld: number
  ledgerEntriesUnreplayed: number
  ledgerRowsReErased: number
}>

export const ZERO_BACKUP_ERASURE_REPLAY_COUNTS: BackupErasureReplayCounts = Object.freeze(
  {
    ledgerEntriesConsidered: 0,
    ledgerEntriesAlreadyErased: 0,
    ledgerEntriesReapplied: 0,
    ledgerEntriesHeld: 0,
    ledgerEntriesUnreplayed: 0,
    ledgerRowsReErased: 0,
  },
)

export type RestoreResurrectionFenceResult = Readonly<{
  /**
   * FALSE whenever any entry could not be re-applied. A restored cell is only
   * verified when the fence converged: every resurrected erasure is gone again.
   */
  verified: boolean
  counts: BackupErasureReplayCounts
  /** Ledger entry ids the fence could not re-apply, for the operator report. */
  unreplayedEntryIds: readonly string[]
  /** Ledger entry ids deferred under a documented hold. */
  heldEntryIds: readonly string[]
}>

export const RESTORE_RESURRECTION_FENCE_UNVERIFIED =
  'restored cell is not verified: backup-erasure ledger entries were not re-applied'

function replayerKey(
  context: BackupErasureLedgerContext,
  subjectClass: BackupErasureSubjectClass,
): string {
  return `${context}:${subjectClass}`
}

/**
 * Re-apply every erasure a restore undid, then report whether the restored
 * database may be declared verified.
 *
 * Runs inside the caller's transaction so a replayer that throws leaves the
 * restored database untouched AND leaves `verified` false — there is no state
 * in which some subjects were re-erased and the database was still opened.
 */
export async function applyRestoreResurrectionFence(
  tx: Tx,
  input: Readonly<{
    restorePointAt: Date
    replayers: readonly BackupErasureReplayer[]
  }>,
): Promise<RestoreResurrectionFenceResult> {
  const registry = new Map<string, BackupErasureReplayer>()
  for (const replayer of input.replayers) {
    registry.set(replayerKey(replayer.context, replayer.subjectClass), replayer)
  }

  const plan = planBackupErasureReplay(
    await readBackupErasureLedger(tx),
    input.restorePointAt,
  )

  const unreplayedEntryIds: string[] = []
  const heldEntryIds: string[] = []
  let alreadyErased = 0
  let reapplied = 0
  let rowsReErased = 0

  for (const item of plan) {
    if (item.disposition === 'already_erased') {
      alreadyErased += 1
      continue
    }
    if (item.disposition === 'held') {
      heldEntryIds.push(item.entry.id)
      continue
    }
    const replayer = registry.get(
      replayerKey(item.entry.context, item.entry.subjectClass),
    )
    if (!replayer) {
      unreplayedEntryIds.push(item.entry.id)
      continue
    }
    rowsReErased += await replayer.reErase(tx, item.entry)
    reapplied += 1
  }

  return {
    verified: unreplayedEntryIds.length === 0,
    counts: {
      ledgerEntriesConsidered: plan.length,
      ledgerEntriesAlreadyErased: alreadyErased,
      ledgerEntriesReapplied: reapplied,
      ledgerEntriesHeld: heldEntryIds.length,
      ledgerEntriesUnreplayed: unreplayedEntryIds.length,
      ledgerRowsReErased: rowsReErased,
    },
    unreplayedEntryIds,
    heldEntryIds,
  }
}
