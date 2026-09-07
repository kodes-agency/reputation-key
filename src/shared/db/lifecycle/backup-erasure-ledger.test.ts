import { describe, expect, it } from 'vitest'
import {
  BACKUP_ERASURE_LEDGER_CONTENT_ERROR,
  applyRestoreResurrectionFence,
  planBackupErasureReplay,
  validateBackupErasureLedgerAppend,
  type BackupErasureLedgerAppend,
  type BackupErasureLedgerEntry,
  type BackupErasureReplayer,
} from './backup-erasure-ledger'
import {
  assertRestoredDatabaseVerified,
  mergeRecoveryFenceCounts,
} from '#/shared/ops/recovery-fence'
import type { Tx } from '#/shared/outbox/commit'

const LINEAGE = '30000000-0000-4000-8000-000000000001'
const PROPERTY = '30000000-0000-4000-8000-000000000002'
const ERASED_AT = new Date('2026-08-20T12:00:00.000Z')

const append = (
  overrides: Partial<BackupErasureLedgerAppend> = {},
): BackupErasureLedgerAppend => ({
  subjectClass: 'organization',
  organizationId: 'org-ledger',
  context: 'guest',
  closureLineageId: LINEAGE,
  lifecycleRevision: 1,
  effectiveErasureAt: ERASED_AT,
  erasedRowCount: 12,
  evidenceRef: 'guest:purge:complete:r1',
  ...overrides,
})

const entry = (
  overrides: Partial<BackupErasureLedgerEntry> = {},
): BackupErasureLedgerEntry => ({
  id: '30000000-0000-4000-8000-00000000000a',
  ...append(),
  ...overrides,
})

describe('backup erasure ledger append (LIF-01-T15)', () => {
  it('refuses free text anywhere an operator might paste content', () => {
    expect(() =>
      validateBackupErasureLedgerAppend(
        append({ evidenceRef: 'guest feedback: "the room was filthy"' }),
      ),
    ).toThrow(BACKUP_ERASURE_LEDGER_CONTENT_ERROR)
    expect(() =>
      validateBackupErasureLedgerAppend(
        append({ holdReference: 'hold because guest@example.com asked' }),
      ),
    ).toThrow(BACKUP_ERASURE_LEDGER_CONTENT_ERROR)
    expect(() =>
      validateBackupErasureLedgerAppend(
        append({ subjectClass: 'privacy_subject', subjectRef: 'guest@example.com' }),
      ),
    ).toThrow(BACKUP_ERASURE_LEDGER_CONTENT_ERROR)
  })

  it('binds the subject shape to the subject class', () => {
    expect(() =>
      validateBackupErasureLedgerAppend(append({ propertyId: PROPERTY })),
    ).toThrow(/not scoped to a Property/u)
    expect(() =>
      validateBackupErasureLedgerAppend(append({ subjectClass: 'property' })),
    ).toThrow(/names exactly one Property/u)
    expect(() =>
      validateBackupErasureLedgerAppend(append({ subjectClass: 'privacy_subject' })),
    ).toThrow(/names exactly one verified subject/u)
    expect(() =>
      validateBackupErasureLedgerAppend(
        append({ subjectClass: 'property', propertyId: PROPERTY }),
      ),
    ).not.toThrow()
  })

  it('refuses an unbounded or negative erasure count', () => {
    expect(() =>
      validateBackupErasureLedgerAppend(append({ erasedRowCount: -1 })),
    ).toThrow(/bounded integers/u)
    expect(() =>
      validateBackupErasureLedgerAppend(append({ lifecycleRevision: 0 })),
    ).toThrow(/bounded integers/u)
  })
})

describe('restore replay plan (LIF-01-T15)', () => {
  it('replays only erasures the restore point predates', () => {
    const plan = planBackupErasureReplay(
      [entry()],
      new Date(ERASED_AT.getTime() - 60_000),
    )
    expect(plan[0]?.disposition).toBe('replay_required')
  })

  it('is convergent: an erasure already in the restored bytes is not replayed', () => {
    // Double-applying would be reported as work the fence did not do.
    expect(
      planBackupErasureReplay([entry()], new Date(ERASED_AT.getTime() + 60_000))[0]
        ?.disposition,
    ).toBe('already_erased')
    expect(planBackupErasureReplay([entry()], ERASED_AT)[0]?.disposition).toBe(
      'already_erased',
    )
  })

  it('defers an entry under a documented delayed-erasure/legal-hold policy', () => {
    const held = entry({ holdReference: 'legal-hold:2026-08:counsel-4471' })
    const before = new Date(ERASED_AT.getTime() - 60_000)
    expect(planBackupErasureReplay([held], before)[0]?.disposition).toBe('held')

    const released = { ...held, holdReleasedAt: new Date('2026-08-27T00:00:00.000Z') }
    expect(planBackupErasureReplay([released], before)[0]?.disposition).toBe(
      'replay_required',
    )
  })
})

describe('restore resurrection fence (LIF-01-T15)', () => {
  const guestReplayer = (rows: number): BackupErasureReplayer => ({
    context: 'guest',
    subjectClass: 'organization',
    reErase: async () => rows,
  })

  const read = (entries: readonly BackupErasureLedgerEntry[]): Tx =>
    ({
      execute: async () => ({
        rows: entries.map((candidate) => ({
          id: candidate.id,
          subject_class: candidate.subjectClass,
          organization_id: candidate.organizationId,
          property_id: candidate.propertyId ?? null,
          subject_ref: candidate.subjectRef ?? null,
          context: candidate.context,
          closure_lineage_id: candidate.closureLineageId,
          lifecycle_revision: candidate.lifecycleRevision,
          effective_erasure_at: candidate.effectiveErasureAt.toISOString(),
          erased_row_count: candidate.erasedRowCount,
          evidence_ref: candidate.evidenceRef,
          hold_reference: candidate.holdReference ?? null,
          hold_released_at: candidate.holdReleasedAt?.toISOString() ?? null,
        })),
      }),
      select: () => ({
        from: () => ({
          where: async () => [],
        }),
      }),
    }) as unknown as Tx

  it('re-applies a resurrected erasure and reports the re-erased rows', async () => {
    const result = await applyRestoreResurrectionFence(read([entry()]), {
      restorePointAt: new Date(ERASED_AT.getTime() - 60_000),
      replayers: [guestReplayer(12)],
    })
    expect(result.verified).toBe(true)
    expect(result.counts).toMatchObject({
      ledgerEntriesConsidered: 1,
      ledgerEntriesReapplied: 1,
      ledgerRowsReErased: 12,
      ledgerEntriesUnreplayed: 0,
    })
  })

  it('fails closed when an entry has no registered replayer', async () => {
    // A partially re-erased restore must never be declared verified.
    const result = await applyRestoreResurrectionFence(read([entry()]), {
      restorePointAt: new Date(ERASED_AT.getTime() - 60_000),
      replayers: [],
    })
    expect(result.verified).toBe(false)
    expect(result.unreplayedEntryIds).toEqual([entry().id])
    expect(() => assertRestoredDatabaseVerified(result)).toThrow(/is not verified/u)
  })

  it('does not re-apply a held entry and still verifies the database', async () => {
    const held = entry({ holdReference: 'legal-hold:2026-08:counsel-4471' })
    const result = await applyRestoreResurrectionFence(read([held]), {
      restorePointAt: new Date(ERASED_AT.getTime() - 60_000),
      replayers: [guestReplayer(12)],
    })
    expect(result.counts.ledgerEntriesHeld).toBe(1)
    expect(result.counts.ledgerRowsReErased).toBe(0)
    expect(result.heldEntryIds).toEqual([held.id])
    expect(result.verified).toBe(true)
    expect(() => assertRestoredDatabaseVerified(result)).not.toThrow()
  })

  it('reports the replay counts alongside the base fence counts', () => {
    const base = { sessionsInvalidated: 3 } as never
    expect(mergeRecoveryFenceCounts(base)).toMatchObject({
      sessionsInvalidated: 3,
      ledgerEntriesReapplied: 0,
      ledgerRowsReErased: 0,
    })
  })
})
