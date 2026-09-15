// Where a reply command's result goes (InboxReplyCacheChange.reviewId): under
// the cached detail of the review the command was issued for, never under the
// item that happens to be open when a slow command settles.

import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReplyPublicationCheckResult } from '#/contexts/review/application/public-api'
import type { InboxItemDetailResult } from '#/contexts/inbox/application/public-api'
import { inboxKeys } from '#/shared/queries/query-keys'
import { BULLMQ_ACTIVITY_LAG_MS, inboxCachePolicy } from './inbox-cache-policy'
import { replyCheckMutationOptions } from './reply-check-feedback'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  createSerializationAdapter: (adapter: unknown) => adapter,
}))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

const ID = 'item-1'

const detail = (itemId: string, reviewId: string, replyId: string) =>
  ({
    item: { id: itemId, sourceId: reviewId, status: 'open', sourceType: 'review' },
    reply: {
      id: replyId,
      reviewId,
      status: 'publish_failed',
      publicationState: 'ambiguous',
    },
  }) as unknown as InboxItemDetailResult

type CheckInput = Readonly<{ data: Readonly<{ reviewId: string }> }>

describe('a check that settles after the manager opened another item', () => {
  it('writes the reply to the item it checked, and toasts nothing over the other one', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const itemA = detail('item-a', 'review-a', 'reply-a')
    const itemB = detail('item-b', 'review-b', 'reply-b')
    qc.setQueryData(inboxKeys.detail('item-a'), itemA)
    qc.setQueryData(inboxKeys.detail('item-b'), itemB)
    const answer = Promise.withResolvers<ReplyPublicationCheckResult>()

    // The pane's options for the item it has open, as `useReplyActions` builds
    // them on every render, composed the way `useActionMutation` composes them.
    const optionsFor = (itemId: string) => {
      const options = replyCheckMutationOptions({
        reviewId: (qc.getQueryData(inboxKeys.detail(itemId)) as InboxItemDetailResult)
          .item.sourceId,
        onReplyChanged: (change) => inboxCachePolicy.onReplyChanged(qc, change),
        onCheckFailed: () => {},
      })
      return {
        mutationFn: (_input: CheckInput) => answer.promise,
        onSuccess: (result: ReplyPublicationCheckResult, input: CheckInput) =>
          options.onSuccess?.(result, input),
      }
    }
    const observer = new MutationObserver(qc, optionsFor('item-a'))

    const pending = observer.mutate({ data: { reviewId: 'review-a' } })
    // Item B opens while the read is in flight: the SAME observer re-renders
    // with B's closure, and TanStack hands the pending mutation those options
    // (query-core mutationObserver.ts setOptions, `status === 'pending'`).
    observer.setOptions(optionsFor('item-b'))
    const liveReply = {
      ...itemA.reply,
      status: 'published',
      publicationState: 'published',
    } as unknown as ReplyPublicationCheckResult['reply']
    answer.resolve({
      reply: liveReply,
      outcome: 'live_on_google',
      checkedAt: new Date('2026-09-14T14:05:00.000Z'),
      nextAutomaticCheckAt: null,
    })
    await pending

    expect(qc.getQueryData<InboxItemDetailResult>(inboxKeys.detail('item-b'))).toEqual(
      itemB,
    )
    expect(
      qc.getQueryData<InboxItemDetailResult>(inboxKeys.detail('item-a'))?.reply,
    ).toEqual(liveReply)
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('inboxCachePolicy reply changes', () => {
  // A real client: a reply result is filed under the cached detail whose item
  // is about the command's review, which the fake above cannot enumerate.
  const realQc = () => {
    const qc = new QueryClient()
    const invalidated: Array<ReadonlyArray<unknown>> = []
    const invalidate = qc.invalidateQueries.bind(qc)
    qc.invalidateQueries = ((filters?: { queryKey?: ReadonlyArray<unknown> }) => {
      invalidated.push(filters?.queryKey ?? [])
      return invalidate(filters)
    }) as QueryClient['invalidateQueries']
    return { qc, invalidated }
  }
  const detailOf = (itemId: string, reviewId: string) =>
    ({
      item: { id: itemId, sourceId: reviewId },
      reply: null,
    }) as unknown as InboxItemDetailResult
  const replyOf = (status: string) =>
    ({ id: 'reply-1', status }) as unknown as InboxItemDetailResult['reply']

  it('patches the detail and refreshes governed list state after a workflow change', () => {
    const { qc, invalidated } = realQc()
    qc.setQueryData(inboxKeys.detail(ID), detailOf(ID, 'review-1'))
    qc.setQueryData(inboxKeys.notes(ID), [])
    const reply = replyOf('pending_approval')

    inboxCachePolicy.onReplyChanged(qc, {
      kind: 'state_changed',
      reply,
      reviewId: 'review-1',
    })

    expect(qc.getQueryData(inboxKeys.detail(ID))).toEqual({
      ...detailOf(ID, 'review-1'),
      reply,
    })
    expect(qc.getQueryData(inboxKeys.notes(ID))).toEqual([])
    expect(invalidated).toEqual([inboxKeys.lists(), inboxKeys.counts()])
  })

  it("files a result under its own review's item, never under another open one", () => {
    const { qc } = realQc()
    qc.setQueryData(inboxKeys.detail('item-a'), detailOf('item-a', 'review-a'))
    qc.setQueryData(inboxKeys.detail('item-b'), detailOf('item-b', 'review-b'))
    const change = {
      kind: 'state_changed',
      reply: replyOf('published'),
      reviewId: 'review-a',
    } as const

    expect(inboxCachePolicy.isReplyChangeForItem(qc, 'item-b', change)).toBe(false)
    expect(inboxCachePolicy.isReplyChangeForItem(qc, 'item-a', change)).toBe(true)
    inboxCachePolicy.onReplyChanged(qc, change)

    expect(qc.getQueryData(inboxKeys.detail('item-b'))).toEqual(
      detailOf('item-b', 'review-b'),
    )
    expect(
      qc.getQueryData<InboxItemDetailResult>(inboxKeys.detail('item-a'))?.reply,
    ).toEqual(change.reply)
  })

  it('does not make folder data stale when an autosave returns a draft', () => {
    const { qc, invalidated } = realQc()

    inboxCachePolicy.onReplyChanged(qc, {
      kind: 'draft_saved',
      reply: replyOf('draft'),
      reviewId: 'review-1',
    })
    vi.advanceTimersByTime(BULLMQ_ACTIVITY_LAG_MS + 1000)

    expect(invalidated).toEqual([])
  })

  it("re-reads the checked review's detail, the lists and the counts after a failed check", () => {
    const { qc, invalidated } = realQc()
    qc.setQueryData(inboxKeys.detail('item-a'), detailOf('item-a', 'review-a'))
    qc.setQueryData(inboxKeys.detail('item-b'), detailOf('item-b', 'review-b'))

    inboxCachePolicy.onReplyCheckFailed(qc, 'review-a')

    expect(invalidated).toEqual([
      inboxKeys.detail('item-a'),
      inboxKeys.lists(),
      inboxKeys.counts(),
    ])
    expect(qc.getQueryState(inboxKeys.detail('item-a'))?.isInvalidated).toBe(true)
    expect(qc.getQueryState(inboxKeys.detail('item-b'))?.isInvalidated).toBe(false)
  })
})
