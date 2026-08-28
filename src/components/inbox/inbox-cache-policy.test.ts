// InboxCachePolicy tests — the invalidation topology, BullMQ-lag constant, and
// reply-poll predicate that useInboxDetail (and future inbox UI) no longer know.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import {
  inboxCachePolicy,
  replyRefetchInterval,
  BULLMQ_ACTIVITY_LAG_MS,
  REPLY_POLL_INTERVAL_MS,
} from './inbox-cache-policy'
import { inboxKeys } from '#/shared/queries/query-keys'
import type {
  InboxItem,
  InboxItemDetailResult,
} from '#/contexts/inbox/application/public-api'

// ── Fake QueryClient ────────────────────────────────────────────

const makeFakeQc = () => {
  const invalidated: Array<ReadonlyArray<unknown>> = []
  const setDataCalls: Array<{
    key: ReadonlyArray<unknown>
    updater: (old: unknown) => unknown
  }> = []
  const qc = {
    invalidateQueries: (filters: { queryKey: ReadonlyArray<unknown> }) => {
      invalidated.push(filters.queryKey)
      return Promise.resolve()
    },
    setQueryData: (key: ReadonlyArray<unknown>, updater: (old: unknown) => unknown) => {
      setDataCalls.push({ key, updater })
    },
  } as unknown as QueryClient
  return { qc, invalidated, setDataCalls }
}

const ID = 'item-1'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Key topology the policy relies on ───────────────────────────

describe('inbox key topology (pinned)', () => {
  it('detail(id) is a prefix of notes(id) and activity(id)', () => {
    const detail = inboxKeys.detail(ID)
    for (const child of [inboxKeys.notes(ID), inboxKeys.activity(ID)]) {
      expect(child.slice(0, detail.length)).toEqual(detail)
    }
  })
})

// ── onStatusChanged ─────────────────────────────────────────────

describe('inboxCachePolicy.onItemStatusChanged', () => {
  const updated = { id: ID, status: 'closed' } as unknown as InboxItem

  it('patches the selected detail and invalidates only folder data immediately', () => {
    const { qc, invalidated, setDataCalls } = makeFakeQc()

    inboxCachePolicy.onItemStatusChanged(qc, updated)

    expect(setDataCalls).toHaveLength(1)
    expect(setDataCalls[0].key).toEqual(inboxKeys.detail(ID))
    const old = { item: { id: ID, status: 'open' }, reply: null }
    expect(setDataCalls[0].updater(old)).toEqual({ ...old, item: updated })
    expect(invalidated).not.toContainEqual(inboxKeys.detail(ID))
    expect(invalidated).not.toContainEqual(inboxKeys.notes(ID))
    expect(invalidated).toContainEqual(inboxKeys.lists())
    expect(invalidated).toContainEqual(inboxKeys.counts())
    expect(invalidated).toContainEqual(inboxKeys.lastVisitCount())
  })

  it('re-invalidates activity only after the BullMQ lag', () => {
    const { qc, invalidated } = makeFakeQc()

    inboxCachePolicy.onItemStatusChanged(qc, updated)
    // Not yet — the activity row is inserted ~2s after the status change.
    expect(invalidated).not.toContainEqual(inboxKeys.activity(ID))

    vi.advanceTimersByTime(BULLMQ_ACTIVITY_LAG_MS)
    expect(invalidated).toContainEqual(inboxKeys.activity(ID))
  })
})

describe('inboxCachePolicy.onFeedbackHandlingChanged', () => {
  it('patches item and outcome history, moving folders only when status changed', () => {
    const { qc, invalidated, setDataCalls } = makeFakeQc()
    const result = {
      item: { id: ID, status: 'closed', commandRevision: 2 },
      feedbackHandling: {
        cycleNumber: 1,
        sourceRevision: 1,
        stateRevision: 2,
        status: 'closed',
        currentOutcome: { id: 'outcome-1', outcomeRevision: 1 },
        history: [{ id: 'outcome-1', outcomeRevision: 1 }],
      },
    } as unknown as Parameters<typeof inboxCachePolicy.onFeedbackHandlingChanged>[1]

    inboxCachePolicy.onFeedbackHandlingChanged(qc, result, true)

    expect(setDataCalls).toHaveLength(1)
    const old = { item: { id: ID, status: 'open' }, feedbackHandling: null }
    expect(setDataCalls[0]!.updater(old)).toEqual({
      ...old,
      item: result.item,
      feedbackHandling: result.feedbackHandling,
    })
    expect(invalidated).toContainEqual(inboxKeys.lists())
    expect(invalidated).toContainEqual(inboxKeys.counts())
    expect(invalidated).toContainEqual(inboxKeys.lastVisitCount())
  })

  it('keeps folder caches stable for a history-only correction', () => {
    const { qc, invalidated } = makeFakeQc()
    const result = {
      item: { id: ID, status: 'closed', commandRevision: 3 },
      feedbackHandling: { history: [{ id: 'outcome-2', outcomeRevision: 2 }] },
    } as unknown as Parameters<typeof inboxCachePolicy.onFeedbackHandlingChanged>[1]

    inboxCachePolicy.onFeedbackHandlingChanged(qc, result, false)

    expect(invalidated).not.toContainEqual(inboxKeys.lists())
    expect(invalidated).not.toContainEqual(inboxKeys.counts())
    expect(invalidated).not.toContainEqual(inboxKeys.lastVisitCount())
  })
})

// ── onReplyMutated ──────────────────────────────────────────────

describe('inboxCachePolicy reply changes', () => {
  it.each(['draft_saved', 'state_changed'] as const)(
    '%s writes only the reply into the selected detail cache',
    (kind) => {
      const { qc, invalidated, setDataCalls } = makeFakeQc()
      const reply = {
        id: 'reply-1',
        status: kind === 'draft_saved' ? 'draft' : 'pending_approval',
      } as unknown as InboxItemDetailResult['reply']

      inboxCachePolicy.onReplyChanged(qc, ID, { kind, reply })

      expect(setDataCalls).toHaveLength(1)
      expect(setDataCalls[0].key).toEqual(inboxKeys.detail(ID))
      const old = { item: { id: ID }, reply: null, notes: [] }
      expect(setDataCalls[0].updater(old)).toEqual({ ...old, reply })
      expect(setDataCalls[0].updater(undefined)).toBeUndefined()
      expect(invalidated).toEqual([])
    },
  )

  it('does not make folder data stale when an autosave returns a draft', () => {
    const { qc, invalidated } = makeFakeQc()
    const reply = {
      id: 'reply-1',
      status: 'draft',
    } as unknown as InboxItemDetailResult['reply']

    inboxCachePolicy.onReplyChanged(qc, ID, { kind: 'draft_saved', reply })
    vi.advanceTimersByTime(BULLMQ_ACTIVITY_LAG_MS + 1000)

    expect(invalidated).toEqual([])
  })
})

// ── onNoteAdded ─────────────────────────────────────────────────

describe('inboxCachePolicy.onNoteAdded', () => {
  it('advances the cached command fence, invalidates notes, and retains a newer fence', () => {
    const { qc, invalidated, setDataCalls } = makeFakeQc()

    inboxCachePolicy.onNoteAdded(qc, ID, 5)

    expect(invalidated).toContainEqual(inboxKeys.notes(ID))
    expect(invalidated).not.toContainEqual(inboxKeys.detail(ID))
    expect(setDataCalls).toHaveLength(1)
    const old = {
      item: { id: ID, commandRevision: 4 },
      reply: null,
    } as unknown as InboxItemDetailResult
    const advanced = setDataCalls[0]!.updater(old) as InboxItemDetailResult
    expect(advanced.item.commandRevision).toBe(5)

    const newer = {
      ...old,
      item: { ...old.item, commandRevision: 7 },
    }
    const retained = setDataCalls[0]!.updater(newer) as InboxItemDetailResult
    expect(retained.item.commandRevision).toBe(7)

    vi.advanceTimersByTime(BULLMQ_ACTIVITY_LAG_MS)
    expect(invalidated).toContainEqual(inboxKeys.activity(ID))
    expect(invalidated).not.toContainEqual(inboxKeys.detail(ID))
  })
})

// ── onItemFolderChanged ─────────────────────────────────────────

describe('inboxCachePolicy.onItemFolderChanged', () => {
  it('invalidates exactly the list/count caches', () => {
    const { qc, invalidated } = makeFakeQc()

    inboxCachePolicy.onItemFolderChanged(qc)

    expect(invalidated).toHaveLength(3)
    expect(invalidated).toContainEqual(inboxKeys.lists())
    expect(invalidated).toContainEqual(inboxKeys.counts())
    expect(invalidated).toContainEqual(inboxKeys.lastVisitCount())
  })
})

describe('inboxCachePolicy.onBulkReopened', () => {
  it('refreshes every folder projection after complete or partial results', () => {
    const { qc, invalidated } = makeFakeQc()

    inboxCachePolicy.onBulkReopened(qc)

    expect(invalidated).toEqual([
      inboxKeys.lists(),
      inboxKeys.counts(),
      inboxKeys.lastVisitCount(),
    ])
  })
})

// ── replyRefetchInterval (reply-poll predicate) ─────────────────
//
//   reply status   → interval
//   approved       → REPLY_POLL_INTERVAL_MS (publish is async via BullMQ)
//   anything else  → false (stop polling)
//   no reply       → false

describe('replyRefetchInterval', () => {
  it('polls while the reply is approved (publish pending)', () => {
    expect(replyRefetchInterval({ status: 'approved' })).toBe(REPLY_POLL_INTERVAL_MS)
  })

  it.each(['draft', 'published', 'rejected'])('stops polling for status %s', (status) => {
    expect(replyRefetchInterval({ status })).toBe(false)
  })

  it('does not poll when there is no reply', () => {
    expect(replyRefetchInterval(undefined)).toBe(false)
    expect(replyRefetchInterval(null)).toBe(false)
  })
})
