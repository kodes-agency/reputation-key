import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import {
  decodeErasureJournalEntry,
  erasureJournalKey,
} from '#/shared/db/lifecycle/erasure-journal.server'
import {
  feedbackId,
  guestResponseId,
  guestSessionId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import { guestFeedbackRetracted } from '../domain/events'
import type { GuestResponse } from '../domain/guest-response'
import { createAtomicGuestResponseCommandStore } from './guest-response-command-store'

const NOW = new Date('2026-11-08T12:00:00.000Z')
const JOURNAL_ID = '83000000-0000-4000-8000-000000000001'
const RESPONSE_ID = guestResponseId('83000000-0000-4000-8000-000000000002')

function response(): GuestResponse {
  return {
    id: RESPONSE_ID,
    organizationId: organizationId('org-guest-withdrawal-journal'),
    propertyId: propertyId('83000000-0000-4000-8000-000000000003'),
    portalId: portalId('83000000-0000-4000-8000-000000000004'),
    sessionId: guestSessionId('83000000-0000-4000-8000-000000000005'),
    sessionExpiresAt: new Date('2026-11-09T11:00:00.000Z'),
    status: 'submitted',
    integrityOutcome: 'accepted',
    integrityReasonCode: 'initial_submission',
    integrityRevision: 1,
    integrityAssessedAt: NOW,
    rating: 2,
    category: null,
    text: 'A private note that must never reach the journal.',
    responseConsent: true,
    textConsent: true,
    mediaConsent: false,
    privateFeedbackThreshold: 3,
    experienceSnapshot: null,
    staffAttribution: null,
    ratingSourceEventId: '83000000-0000-4000-8000-000000000006',
    feedbackSourceEventId: '83000000-0000-4000-8000-000000000007',
    correctionCount: 0,
    submittedAt: new Date('2026-11-08T11:00:00.000Z'),
    correctedAt: null,
    feedbackSubmittedAt: new Date('2026-11-08T11:00:00.000Z'),
    feedbackSubmissionRevision: 1,
    feedbackWithdrawnAt: null,
    moderatedAt: null,
    deletedAt: null,
    retentionDeadline: new Date('2028-11-08T11:00:00.000Z'),
    schemaVersion: 1,
  }
}

function database(transaction: ReturnType<typeof vi.fn>, matches = true) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn().mockResolvedValue(matches ? [{ id: RESPONSE_ID }] : []),
  }
  return { transaction, select: vi.fn(() => chain) } as unknown as Database
}

const paths = ['guest_response', 'guest_feedback'] as const

function withdraw(
  store: ReturnType<typeof createAtomicGuestResponseCommandStore>,
  kind: (typeof paths)[number],
) {
  const previous = response()
  if (kind === 'guest_response') {
    return store.commitWithdrawn({ ...previous, status: 'deleted', deletedAt: NOW }, [])
  }
  const fact = guestFeedbackRetracted({
    feedbackId: feedbackId(previous.id),
    organizationId: previous.organizationId,
    propertyId: previous.propertyId,
    portalId: previous.portalId,
    supersedesSourceEventId: previous.feedbackSourceEventId!,
    responseRevision: previous.feedbackSubmissionRevision!,
    occurredAt: NOW,
  })
  return store.commitFeedbackWithdrawn(
    previous,
    {
      ...previous,
      text: null,
      textConsent: false,
      feedbackSourceEventId: null,
      feedbackWithdrawnAt: NOW,
    },
    fact,
  )
}

describe.each(paths)('%s withdrawal journal', (kind) => {
  it('waits for durable IDs-only evidence before opening the deletion transaction', async () => {
    let accept!: () => void
    const put = vi.fn(
      (_key: string, _bytes: string) =>
        new Promise<void>((resolve) => {
          accept = resolve
        }),
    )
    const transaction = vi.fn().mockResolvedValue('applied')
    const store = createAtomicGuestResponseCommandStore(
      database(transaction),
      () => NOW,
      {
        put,
        alert: vi.fn(),
        idGen: () => JOURNAL_ID,
      },
    )

    const pending = withdraw(store, kind)
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce())
    expect(transaction).not.toHaveBeenCalled()
    const [key, bytes] = put.mock.calls[0]!
    const entry = decodeErasureJournalEntry(bytes)
    expect(key).toBe(erasureJournalKey(JOURNAL_ID))
    expect(entry).toMatchObject({
      id: JOURNAL_ID,
      recordedBeforeErasure: true,
      context: 'guest',
      organizationId: response().organizationId,
      propertyId: response().propertyId,
      journalTargets: { kind, ids: [RESPONSE_ID] },
    })
    expect(bytes).not.toContain(response().text)
    expect(bytes).not.toContain(response().sessionId)
    accept()
    await expect(pending).resolves.toBe('applied')
    expect(transaction).toHaveBeenCalledOnce()
  })

  it('alerts and leaves data intact when the journal cannot be written', async () => {
    let dataExists = true
    const transaction = vi.fn(async () => {
      dataExists = false
      return 'applied'
    })
    const alert = vi.fn()
    const store = createAtomicGuestResponseCommandStore(
      database(transaction),
      () => NOW,
      {
        put: vi.fn().mockRejectedValue(new Error('bucket unavailable')),
        alert,
        idGen: () => JOURNAL_ID,
      },
    )

    await expect(withdraw(store, kind)).rejects.toThrow('journal write failed')
    expect(alert).toHaveBeenCalledWith({ journalId: JOURNAL_ID, context: 'guest' })
    expect(transaction).not.toHaveBeenCalled()
    expect(dataExists).toBe(true)
  })

  it('retains the independent intent when the deletion transaction fails', async () => {
    const journal = new Map<string, string>()
    const transaction = vi.fn().mockRejectedValue(new Error('transaction failed'))
    const store = createAtomicGuestResponseCommandStore(
      database(transaction),
      () => NOW,
      {
        put: async (key: string, bytes: string) => {
          journal.set(key, bytes)
        },
        alert: vi.fn(),
        idGen: () => JOURNAL_ID,
      },
    )

    await expect(withdraw(store, kind)).rejects.toThrow('transaction failed')
    expect(journal.size).toBe(1)
    const entry = decodeErasureJournalEntry(journal.get(erasureJournalKey(JOURNAL_ID))!)
    expect(entry.journalTargets).toEqual({ kind, ids: [RESPONSE_ID] })
  })

  it('keeps the existing withdrawal path when journal activation is absent', async () => {
    const transaction = vi.fn().mockResolvedValue('applied')
    const store = createAtomicGuestResponseCommandStore(database(transaction), () => NOW)
    await expect(withdraw(store, kind)).resolves.toBe('applied')
    expect(transaction).toHaveBeenCalledOnce()
  })

  it('records no erasure intent when the session or response preflight does not match', async () => {
    const transaction = vi.fn().mockResolvedValue('applied')
    const put = vi.fn()
    const store = createAtomicGuestResponseCommandStore(
      database(transaction, false),
      () => NOW,
      { put, alert: vi.fn(), idGen: () => JOURNAL_ID },
    )

    await expect(withdraw(store, kind)).resolves.toBe('conflict')
    expect(put).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })
})

describe('operator erasure journal', () => {
  const erase = (store: ReturnType<typeof createAtomicGuestResponseCommandStore>) =>
    store.commitErased({ ...response(), status: 'deleted', deletedAt: NOW }, [])

  it('journals IDs only before the deletion transaction, with no session match', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    const transaction = vi.fn().mockResolvedValue('applied')
    const store = createAtomicGuestResponseCommandStore(
      database(transaction),
      () => NOW,
      { put, alert: vi.fn(), idGen: () => JOURNAL_ID },
    )

    await expect(erase(store)).resolves.toBe('applied')
    expect(put).toHaveBeenCalledOnce()
    expect(decodeErasureJournalEntry(put.mock.calls[0]![1]).journalTargets).toEqual({
      kind: 'guest_response',
      ids: [RESPONSE_ID],
    })
    expect(transaction).toHaveBeenCalledOnce()
  })

  it('leaves data intact when the journal cannot be written', async () => {
    const transaction = vi.fn()
    const alert = vi.fn()
    const store = createAtomicGuestResponseCommandStore(
      database(transaction),
      () => NOW,
      {
        put: vi.fn().mockRejectedValue(new Error('down')),
        alert,
        idGen: () => JOURNAL_ID,
      },
    )

    await expect(erase(store)).rejects.toThrow('journal write failed')
    expect(alert).toHaveBeenCalledOnce()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('refuses to erase when no journal is configured', async () => {
    const transaction = vi.fn()
    const store = createAtomicGuestResponseCommandStore(database(transaction), () => NOW)
    await expect(erase(store)).rejects.toThrow('requires the erasure journal')
    expect(transaction).not.toHaveBeenCalled()
  })
})
