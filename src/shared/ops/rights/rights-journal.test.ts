import { describe, expect, it, vi } from 'vitest'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import { createRightsJournal, rightsJournalEntry } from './rights-journal'
import type { RightsRequestPlan } from './rights-request-command'

const plan: RightsRequestPlan = {
  scope: 'property',
  mode: 'apply',
  organizationId: 'org-1',
  propertyId: '11111111-1111-4111-8111-111111111111',
  batchSize: 50,
  receivedAt: new Date('2026-11-01T00:00:00.000Z'),
}

describe('rights journal', () => {
  it('writes the same key and bytes when a request is retried', async () => {
    const writes: Array<[string, string]> = []
    const journal = createRightsJournal({
      put: async (key, bytes) => {
        writes.push([key, bytes])
      },
      alert: vi.fn(),
    })

    await journal.run(plan, ['integration'], async () => 1)
    await journal.run(plan, ['integration'], async () => 1)

    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual(writes[0])
    expect(decodeErasureJournalEntry(writes[0]![1]).propertyId).toBe(plan.propertyId)
  })

  it('writes one entry per context with distinct ids', async () => {
    const journal = createRightsJournal({ put: async () => {}, alert: vi.fn() })

    const ids = journal.entryIds(plan, ['goal', 'metric', 'dashboard'])

    expect(new Set(ids).size).toBe(3)
  })

  it('names the batch ids in its entry and keys it by them', async () => {
    const writes: string[] = []
    const journal = createRightsJournal({
      put: async (_key, bytes) => {
        writes.push(bytes)
      },
      alert: vi.fn(),
    })
    const participant = {
      ...plan,
      scope: 'participant' as const,
      subjectRef: 'a'.repeat(64),
    }
    const first = '22222222-2222-4222-8222-222222222222'
    const second = '33333333-3333-4333-8333-333333333333'

    await journal.runBatch(
      participant,
      'staff',
      { kind: 'staff_participant', ids: [first] },
      async () => 1,
    )
    await journal.runBatch(
      participant,
      'staff',
      { kind: 'staff_participant', ids: [second] },
      async () => 1,
    )

    const entries = writes.map(decodeErasureJournalEntry)
    expect(entries.map((entry) => entry.journalTargets?.ids)).toEqual([[first], [second]])
    expect(entries[0]!.id).not.toBe(entries[1]!.id)
  })

  it('fails closed without a store', async () => {
    const journal = createRightsJournal(undefined)

    expect(journal.check(plan, ['integration'])).toContain('no erasure journal store')
    await expect(journal.run(plan, ['integration'], async () => 1)).rejects.toThrow(
      'no erasure journal store',
    )
  })

  it('refuses a plan it cannot date or scope', () => {
    expect(rightsJournalEntry({ ...plan, receivedAt: undefined }, 'review')).toEqual({
      error: expect.stringContaining('received='),
    })
    expect(rightsJournalEntry({ ...plan, propertyId: undefined }, 'review')).toEqual({
      error: expect.stringContaining('--property'),
    })
    expect(rightsJournalEntry({ ...plan, scope: 'participant' }, 'review')).toEqual({
      error: expect.stringContaining('subject-ref'),
    })
  })
})
