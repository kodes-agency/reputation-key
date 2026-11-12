import { z } from 'zod/v4'
import {
  validateBackupErasureLedgerAppend,
  ERASURE_JOURNAL_CONTEXTS,
  ERASURE_JOURNAL_TARGET_KINDS,
  type BackupErasureLedgerEntry,
} from './backup-erasure-ledger'
import { BACKUP_ERASURE_SUBJECT_CLASSES } from '../schema/backup-erasure-ledger.schema'

export const ERASURE_JOURNAL_PREFIX = 'private/erasure-journal/'
export const ERASURE_JOURNAL_EXPIRY_DAYS = 45
export type ErasureJournalEntry = BackupErasureLedgerEntry &
  Readonly<{ recordedBeforeErasure: true }>

const token = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]{0,254}$/u)
const instant = z.iso.datetime().transform((value) => new Date(value))
const entrySchema = z.strictObject({
  id: z.uuid(),
  recordedBeforeErasure: z.literal(true),
  journalTargets: z
    .strictObject({
      kind: z.enum(ERASURE_JOURNAL_TARGET_KINDS),
      ids: z
        .array(z.uuid())
        .min(1)
        .max(200)
        .refine((ids) => new Set(ids).size === ids.length),
    })
    .optional(),
  applyOrder: z
    .strictObject({ planId: z.uuid(), position: z.number().int().nonnegative().max(999) })
    .optional(),
  subjectClass: z.enum(BACKUP_ERASURE_SUBJECT_CLASSES),
  organizationId: token,
  propertyId: z.uuid().optional(),
  subjectRef: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  context: z.enum(ERASURE_JOURNAL_CONTEXTS),
  closureLineageId: z.uuid(),
  lifecycleRevision: z.number().int().positive(),
  effectiveErasureAt: instant,
  erasedRowCount: z.number().int().nonnegative(),
  evidenceRef: token,
  holdReference: token.optional(),
  holdReleasedAt: instant.optional(),
})

function decodeEntry(value: unknown): ErasureJournalEntry {
  const entry = entrySchema.parse(value)
  validateBackupErasureLedgerAppend(entry)
  if (entry.holdReleasedAt && !entry.holdReference) throw new Error('invalid hold')
  return entry
}

export function encodeErasureJournalEntry(entry: ErasureJournalEntry): string {
  try {
    // Parsing rejects extra fields rather than silently persisting caller content.
    return JSON.stringify(decodeEntry(JSON.parse(JSON.stringify(entry))))
  } catch {
    throw new Error('Invalid IDs-only erasure journal entry')
  }
}

export function decodeErasureJournalEntry(bytes: string): ErasureJournalEntry {
  try {
    return decodeEntry(JSON.parse(bytes))
  } catch {
    throw new Error('Invalid IDs-only erasure journal entry')
  }
}

export function erasureJournalKey(id: string): string {
  if (!z.uuid().safeParse(id).success) throw new Error('Invalid erasure journal ID')
  return `${ERASURE_JOURNAL_PREFIX}${id}.json`
}

/** The callback opens the deletion transaction only after the bucket write succeeds. */
export async function journalBeforeErasure<T>(
  entry: ErasureJournalEntry,
  store: Readonly<{
    put(key: string, bytes: string): Promise<void>
    alert(input: { journalId: string; context: ErasureJournalEntry['context'] }): void
  }>,
  erase: () => Promise<T>,
): Promise<T> {
  if (entry.holdReference !== undefined && entry.holdReleasedAt === undefined) {
    throw new Error('Erasure is blocked by an unresolved hold')
  }
  const bytes = encodeErasureJournalEntry(entry)
  try {
    await store.put(erasureJournalKey(entry.id), bytes)
  } catch {
    store.alert({ journalId: entry.id, context: entry.context })
    throw new Error('Erasure journal write failed; erasure was blocked')
  }
  return erase()
}

const exportSchema = z.strictObject({
  format: z.literal('erasure-journal-v1'),
  exportedAt: instant,
  entries: z.array(z.unknown()),
})

export function encodeErasureJournalExport(
  entries: readonly ErasureJournalEntry[],
  exportedAt: Date,
): string {
  const bytes = JSON.stringify({ format: 'erasure-journal-v1', exportedAt, entries })
  decodeErasureJournalExport(bytes)
  return bytes
}

/** Local-file-only input: this reader has no bucket or database access. */
export function decodeErasureJournalExport(bytes: string): Readonly<{
  exportedAt: Date
  entries: readonly ErasureJournalEntry[]
}> {
  try {
    const parsed = exportSchema.parse(JSON.parse(bytes))
    const entries = parsed.entries.map(decodeEntry)
    if (new Set(entries.map(({ id }) => id)).size !== entries.length) {
      throw new Error('duplicate journal ID')
    }
    return { exportedAt: parsed.exportedAt, entries }
  } catch {
    throw new Error('Invalid erasure journal export')
  }
}
