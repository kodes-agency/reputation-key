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

    await journal.run(plan, ['integration'], ['integration'], async () => 1)
    await journal.run(plan, ['integration'], ['integration'], async () => 1)

    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual(writes[0])
    expect(decodeErasureJournalEntry(writes[0]![1]).propertyId).toBe(plan.propertyId)
  })

  it('writes one entry per context with distinct ids', async () => {
    const journal = createRightsJournal({ put: async () => {}, alert: vi.fn() })

    const ids = journal.entryIds(plan, ['goal', 'metric', 'dashboard'])

    expect(new Set(ids).size).toBe(3)
  })

  it("records each entry's place in the whole apply under one plan id", async () => {
    const writes: string[] = []
    const journal = createRightsJournal({
      put: async (_key, bytes) => {
        writes.push(bytes)
      },
      alert: vi.fn(),
    })
    const planContexts = ['integration', 'guest', 'goal', 'metric', 'staff'] as const

    await journal.run(plan, ['goal', 'metric'], planContexts, async () => 1)
    await journal.run(plan, ['staff'], planContexts, async () => 1)

    const orders = writes.map((bytes) => decodeErasureJournalEntry(bytes).applyOrder)
    expect(orders.map((order) => order?.position)).toEqual([2, 3, 4])
    expect(new Set(orders.map((order) => order?.planId)).size).toBe(1)
  })

  it('refuses before any write when the apply order is ambiguous', async () => {
    const put = vi.fn(async () => {})
    const erase = vi.fn(async () => 1)
    const journal = createRightsJournal({ put, alert: vi.fn() })

    await expect(
      journal.run(plan, ['guest'], ['guest', 'staff', 'guest'], erase),
    ).rejects.toThrow('journaled twice')
    await expect(journal.run(plan, ['guest'], ['staff'], erase)).rejects.toThrow(
      'missing from the apply order',
    )
    expect(put).not.toHaveBeenCalled()
    expect(erase).not.toHaveBeenCalled()
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
    await expect(
      journal.run(plan, ['integration'], ['integration'], async () => 1),
    ).rejects.toThrow('no erasure journal store')
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

  it('journals a guest response with its id as the target and a derived subject', () => {
    const responseId = '22222222-2222-4222-8222-222222222222'
    const entry = rightsJournalEntry(
      { ...plan, scope: 'guest-response', responseId },
      'guest',
    )

    expect(entry).toMatchObject({
      subjectClass: 'privacy_subject',
      propertyId: plan.propertyId,
      journalTargets: { kind: 'guest_response', ids: [responseId] },
      subjectRef: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })
    expect(
      rightsJournalEntry(
        { ...plan, scope: 'guest-response', propertyId: undefined },
        'guest',
      ),
    ).toEqual({ error: expect.stringContaining('--property') })
    expect(rightsJournalEntry({ ...plan, scope: 'guest-response' }, 'guest')).toEqual({
      error: expect.stringContaining('response='),
    })
  })
})
