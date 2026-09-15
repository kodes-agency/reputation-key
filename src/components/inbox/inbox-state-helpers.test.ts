import { describe, expect, it } from 'vitest'
import type {
  InboxItem,
  InboxItemDetailResult,
} from '#/contexts/inbox/application/public-api'
import { QueryClient } from '@tanstack/react-query'
import { inboxKeys } from '#/shared/queries/query-keys'
import {
  selectedItemDeparture,
  selectedItemDepartureInCache,
  selectedItemPresenceAction,
  type SelectedItemDetailState,
} from './inbox-state-helpers'

const item = { id: 'item-1' } as InboxItem

describe('selectedItemPresenceAction', () => {
  it('keeps an absent direct-link item while its detail loads independently', () => {
    expect(selectedItemPresenceAction(undefined, 'item-1', false, [])).toBe('keep')
  })

  it('remembers a selected row and closes it only after it leaves the queue', () => {
    expect(selectedItemPresenceAction(undefined, 'item-1', false, [item])).toBe(
      'remember',
    )
    expect(selectedItemPresenceAction('item-1', 'item-1', false, [])).toBe('close')
  })

  it('resets the observation when selection is cleared', () => {
    expect(selectedItemPresenceAction('item-1', undefined, false, [item])).toBe('reset')
  })
})

describe('selectedItemDeparture', () => {
  const LIST_READ_AT = 1_000
  const reply = (status: string, publicationState: string | null = null) =>
    ({
      status,
      publicationState,
      reconcileDueAt: null,
    }) as unknown as InboxItemDetailResult['reply']
  const detailState = (
    overrides: Partial<SelectedItemDetailState> & {
      itemStatus?: 'open' | 'closed'
      reply?: InboxItemDetailResult['reply']
    } = {},
  ): SelectedItemDetailState => ({
    data: {
      item: {
        id: 'item-1',
        status: overrides.itemStatus ?? 'open',
        sourceType: 'review',
      },
      reply: overrides.reply ?? null,
    } as unknown as InboxItemDetailResult,
    status: 'success',
    fetchStatus: 'idle',
    dataUpdatedAt: LIST_READ_AT + 1,
    ...overrides,
  })

  it('keeps an open item whose own reply state moved it to another reply queue', () => {
    const approved = detailState({ reply: reply('approved', 'requested') })
    const departure = selectedItemDeparture('approval', approved, LIST_READ_AT)

    expect(departure).toBe('keep')
    expect(selectedItemPresenceAction('item-1', 'item-1', false, [], departure)).toBe(
      'keep',
    )
    // Checks ended: Waiting for Google → Needs reply.
    expect(
      selectedItemDeparture(
        'waiting',
        detailState({ reply: reply('publish_failed', 'terminal') }),
        LIST_READ_AT,
      ),
    ).toBe('keep')
  })

  it('closes on a detail read that failed after a good read (access lost)', () => {
    const failed = detailState({ reply: reply('approved', 'requested'), status: 'error' })

    expect(selectedItemDeparture('approval', failed, LIST_READ_AT)).toBe('close')
  })

  it('re-reads a detail older than the list read before deciding, then closes a closed item', () => {
    // Closed by another manager: the list refresh arrived first, and the old
    // detail still shows an open review whose reply belongs in this queue.
    const stale = detailState({
      reply: reply('pending_approval'),
      dataUpdatedAt: LIST_READ_AT - 1,
    })
    expect(selectedItemDeparture('approval', stale, LIST_READ_AT)).toBe('refresh')
    expect(selectedItemPresenceAction('item-1', 'item-1', false, [], 'refresh')).toBe(
      'refresh',
    )
    expect(
      selectedItemDeparture(
        'approval',
        { ...stale, fetchStatus: 'fetching' },
        LIST_READ_AT,
      ),
    ).toBe('keep')
    expect(
      selectedItemDeparture(
        'approval',
        detailState({ itemStatus: 'closed', reply: reply('pending_approval') }),
        LIST_READ_AT,
      ),
    ).toBe('close')
  })

  it('keeps an item the list saw move first, once the re-read detail shows its reply moved', () => {
    const staleWaiting = detailState({
      reply: reply('approved', 'sending'),
      dataUpdatedAt: LIST_READ_AT - 1,
    })
    expect(selectedItemDeparture('waiting', staleWaiting, LIST_READ_AT)).toBe('refresh')
    expect(
      selectedItemDeparture(
        'waiting',
        detailState({ reply: reply('publish_failed', 'terminal') }),
        LIST_READ_AT,
      ),
    ).toBe('keep')
  })

  it('closes an item that left a queue a reply cannot decide, or with no detail', () => {
    const moved = detailState({ reply: reply('approved', 'requested') })
    expect(selectedItemDeparture('mine', moved, LIST_READ_AT)).toBe('close')
    expect(selectedItemDeparture('reply', undefined, LIST_READ_AT)).toBe('close')
    expect(
      selectedItemDeparture(
        'waiting',
        detailState({ itemStatus: 'closed', reply: reply('published', 'published') }),
        LIST_READ_AT,
      ),
    ).toBe('close')
    expect(selectedItemPresenceAction('item-1', 'item-1', false, [])).toBe('close')
  })
})

describe('selectedItemDepartureInCache', () => {
  const open = (replyStatus: string) => ({
    item: { id: 'item-1', status: 'open', sourceType: 'review' },
    reply: { status: replyStatus, publicationState: 'requested', reconcileDueAt: null },
  })

  it('reads the latest detail snapshot the poll and command results write', () => {
    const qc = new QueryClient()

    expect(selectedItemDepartureInCache(qc, 'approval', 'item-1', 0)).toBe('close')
    qc.setQueryData(inboxKeys.detail('item-1'), open('approved'))
    expect(selectedItemDepartureInCache(qc, 'approval', 'item-1', 0)).toBe('keep')
    expect(selectedItemDepartureInCache(qc, 'approval', undefined, 0)).toBe('close')
  })

  it('closes once a detail read fails after a good read, though TanStack keeps its data', async () => {
    const qc = new QueryClient()
    qc.setQueryData(inboxKeys.detail('item-1'), open('approved'))
    await qc
      .fetchQuery({
        queryKey: inboxKeys.detail('item-1'),
        queryFn: () => Promise.reject(new Error('forbidden')),
        retry: false,
        staleTime: 0,
      })
      .catch(() => undefined)

    expect(qc.getQueryData(inboxKeys.detail('item-1'))).toEqual(open('approved'))
    expect(selectedItemDepartureInCache(qc, 'approval', 'item-1', 0)).toBe('close')
  })
})
