import { describe, expect, it, vi } from 'vitest'
import { journalBeforeErasure, type ErasureJournalEntry } from './erasure-journal.server'

const entry: ErasureJournalEntry = {
  id: '30000000-0000-4000-8000-00000000000a',
  recordedBeforeErasure: true,
  subjectClass: 'organization',
  organizationId: 'org-journal',
  context: 'guest',
  closureLineageId: '30000000-0000-4000-8000-000000000001',
  lifecycleRevision: 1,
  effectiveErasureAt: new Date('2026-11-07T12:00:00.000Z'),
  erasedRowCount: 0,
  evidenceRef: 'guest:purge:batch-1',
}

describe('journal before nonrepeating erasure', () => {
  it('keeps the subject and alerts when the independent journal cannot be written', async () => {
    let subjectExists = true
    const alert = vi.fn()
    await expect(
      journalBeforeErasure(
        entry,
        {
          put: async () => {
            throw new Error('bucket unavailable')
          },
          alert,
        },
        async () => {
          subjectExists = false
        },
      ),
    ).rejects.toThrow('journal write failed')
    expect(subjectExists).toBe(true)
    expect(alert).toHaveBeenCalledWith({ journalId: entry.id, context: 'guest' })
  })
})

it('waits for durable journal acceptance before opening the deletion transaction', async () => {
  let accept!: () => void
  let transactionOpened = false
  const pending = journalBeforeErasure(
    entry,
    {
      put: () =>
        new Promise<void>((resolve) => {
          accept = resolve
        }),
      alert: vi.fn(),
    },
    async () => {
      transactionOpened = true
      return 7
    },
  )
  expect(transactionOpened).toBe(false)
  accept()
  await expect(pending).resolves.toBe(7)
})

it('refuses unknown content fields before any bucket or deletion work', async () => {
  const put = vi.fn()
  const erase = vi.fn()
  const withContent = { ...entry, body: 'private guest content' }
  await expect(
    journalBeforeErasure(
      withContent,
      {
        put,
        alert: vi.fn(),
      },
      erase,
    ),
  ).rejects.toThrow('IDs-only')
  expect(put).not.toHaveBeenCalled()
  expect(erase).not.toHaveBeenCalled()
})

it('round-trips export dates and rejects duplicate IDs or malformed records', async () => {
  const { encodeErasureJournalExport, decodeErasureJournalExport } =
    await import('./erasure-journal.server')
  const now = new Date('2026-11-07T13:00:00.000Z')
  const bytes = encodeErasureJournalExport([entry], now)
  expect(decodeErasureJournalExport(bytes)).toEqual({ exportedAt: now, entries: [entry] })
  expect(() => encodeErasureJournalExport([entry, entry], now)).toThrow(
    'Invalid erasure journal export',
  )
  expect(() =>
    decodeErasureJournalExport(bytes.replace('org-journal', 'guest@example.com')),
  ).toThrow('Invalid erasure journal export')
  expect(() => decodeErasureJournalExport('{"entries":[]}')).toThrow(
    'Invalid erasure journal export',
  )
})

it('refuses erasure under an unresolved hold before recording an immutable intent', async () => {
  const put = vi.fn()
  const erase = vi.fn()
  await expect(
    journalBeforeErasure(
      { ...entry, holdReference: 'hold:counsel-1' },
      {
        put,
        alert: vi.fn(),
      },
      erase,
    ),
  ).rejects.toThrow('hold')
  expect(put).not.toHaveBeenCalled()
  expect(erase).not.toHaveBeenCalled()
})

it('preserves a bounded IDs-only batch in evidence independent of the restored database', async () => {
  const { encodeErasureJournalExport, decodeErasureJournalExport } =
    await import('./erasure-journal.server')
  const batch = {
    ...entry,
    journalTargets: {
      kind: 'purge_batch' as const,
      ids: ['30000000-0000-4000-8000-000000000002'],
    },
  }
  const bytes = encodeErasureJournalExport([batch], new Date('2026-11-07T13:00:00.000Z'))
  expect(decodeErasureJournalExport(bytes).entries[0]?.journalTargets).toEqual(
    batch.journalTargets,
  )
})

it('rejects empty, duplicate, unbounded or content-bearing batch identities', async () => {
  const { encodeErasureJournalEntry } = await import('./erasure-journal.server')
  const id = '30000000-0000-4000-8000-000000000002'
  for (const ids of [
    [],
    [id, id],
    Array.from(
      { length: 201 },
      (_, index) => `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    ),
    ['guest@example.com'],
  ]) {
    expect(() =>
      encodeErasureJournalEntry({
        ...entry,
        journalTargets: { kind: 'purge_batch', ids },
      }),
    ).toThrow('IDs-only')
  }
})
