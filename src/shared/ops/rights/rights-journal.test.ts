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
