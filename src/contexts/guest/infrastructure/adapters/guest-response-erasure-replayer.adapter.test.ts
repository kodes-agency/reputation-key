import { describe, expect, it, vi } from 'vitest'
import type { BackupErasureLedgerEntry } from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'
import {
  createGuestFeedbackErasureReplayer,
  createGuestResponseErasureReplayer,
} from './guest-response-erasure-replayer.adapter'

const ID = '84000000-0000-4000-8000-000000000001'

function entry(kind: 'guest_response' | 'guest_feedback'): BackupErasureLedgerEntry {
  return {
    id: '84000000-0000-4000-8000-000000000002',
    recordedBeforeErasure: true,
    subjectClass: 'privacy_subject',
    organizationId: 'org-replay',
    subjectRef: 'a'.repeat(64),
    context: 'guest',
    closureLineageId: '84000000-0000-4000-8000-000000000002',
    lifecycleRevision: 1,
    effectiveErasureAt: new Date('2026-11-08T12:00:00.000Z'),
    erasedRowCount: 0,
    evidenceRef: kind,
    journalTargets: { kind, ids: [ID] },
  } as BackupErasureLedgerEntry
}

function tx(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  for (const name of ['update', 'set', 'delete', 'where'])
    chain[name] = vi.fn(() => chain)
  chain.returning = vi.fn().mockResolvedValue(rows)
  return chain as unknown as Tx
}

describe('guest response erasure replayers', () => {
  it('counts the response, feedback and contact rows it re-erases for a resurrected response', async () => {
    const replayer = createGuestResponseErasureReplayer()
    await expect(
      replayer.reErase(tx([{ id: ID }]), entry('guest_response')),
    ).resolves.toBe(3)
  })

  it('reports zero when nothing was resurrected', async () => {
    await expect(
      createGuestFeedbackErasureReplayer().reErase(tx([]), entry('guest_feedback')),
    ).resolves.toBe(0)
  })

  it('rejects an entry of another kind or context', async () => {
    const replayer = createGuestResponseErasureReplayer()
    await expect(replayer.reErase(tx([]), entry('guest_feedback'))).rejects.toThrow(
      'journaled Guest response erasure',
    )
    await expect(
      replayer.reErase(tx([]), { ...entry('guest_response'), context: 'review' }),
    ).rejects.toThrow('journaled Guest response erasure')
  })
})
