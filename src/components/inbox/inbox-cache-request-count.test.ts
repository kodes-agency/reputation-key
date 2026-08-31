import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver, environmentManager } from '@tanstack/react-query'
import { inboxKeys } from '#/shared/queries/query-keys'
import type { InboxItemDetailResult } from '#/contexts/inbox/application/public-api'
import { inboxCachePolicy } from './inbox-cache-policy'

let client: QueryClient
const subscriptions: Array<() => void> = []

beforeEach(() => {
  vi.useFakeTimers()
  environmentManager.setIsServer(() => false)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.mount()
})

afterEach(() => {
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe())
  client.unmount()
  client.clear()
  environmentManager.setIsServer(() => typeof window === 'undefined')
  vi.useRealTimers()
})

function detail(id: string): InboxItemDetailResult {
  return { item: { id }, reply: null } as unknown as InboxItemDetailResult
}

describe('Inbox selected-item request scope', () => {
  it('requests detail and notes once for each selected item transition', async () => {
    const detailRequests: string[] = []
    const noteRequests: string[] = []
    const detailOptions = (id: string) => ({
      queryKey: inboxKeys.detail(id),
      queryFn: async () => {
        detailRequests.push(id)
        return detail(id)
      },
      staleTime: 0,
    })
    const noteOptions = (id: string) => ({
      queryKey: inboxKeys.notes(id),
      queryFn: async () => {
        noteRequests.push(id)
        return []
      },
      staleTime: 0,
    })
    const detailObserver = new QueryObserver(client, detailOptions('item-a'))
    const noteObserver = new QueryObserver(client, noteOptions('item-a'))
    subscriptions.push(
      detailObserver.subscribe(() => {}),
      noteObserver.subscribe(() => {}),
    )

    await vi.advanceTimersByTimeAsync(0)
    detailObserver.setOptions(detailOptions('item-b'))
    noteObserver.setOptions(noteOptions('item-b'))
    await vi.advanceTimersByTimeAsync(0)
    detailObserver.setOptions(detailOptions('item-a'))
    noteObserver.setOptions(noteOptions('item-a'))
    await vi.advanceTimersByTimeAsync(0)

    expect(detailRequests).toEqual(['item-a', 'item-b', 'item-a'])
    expect(noteRequests).toEqual(['item-a', 'item-b', 'item-a'])
    expect(detailObserver.getCurrentResult().data?.item.id).toBe('item-a')
  })

  it('autosaves a draft without requesting detail, notes, activity, or folders', async () => {
    const requests = new Map<string, number>()
    const observe = (label: string, queryKey: readonly unknown[], data: unknown) => {
      const observer = new QueryObserver(client, {
        queryKey,
        queryFn: async () => {
          requests.set(label, (requests.get(label) ?? 0) + 1)
          return data
        },
      })
      subscriptions.push(observer.subscribe(() => {}))
      return observer
    }
    const detailObserver = observe('detail', inboxKeys.detail('item-a'), detail('item-a'))
    observe('notes', inboxKeys.notes('item-a'), [])
    observe('activity', inboxKeys.activity('item-a'), [])
    observe('list', inboxKeys.list({ status: 'open' }), [])
    observe('counts', inboxKeys.countsFor(), {})
    observe('lastVisit', inboxKeys.lastVisitCount(), 0)
    await vi.advanceTimersByTimeAsync(0)

    const reply = { id: 'reply-a', status: 'draft' } as unknown as NonNullable<
      InboxItemDetailResult['reply']
    >
    inboxCachePolicy.onReplyChanged(client, 'item-a', {
      kind: 'draft_saved',
      reply,
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(Object.fromEntries(requests)).toEqual({
      detail: 1,
      notes: 1,
      activity: 1,
      list: 1,
      counts: 1,
      lastVisit: 1,
    })
    expect((detailObserver.getCurrentResult().data as InboxItemDetailResult).reply).toBe(
      reply,
    )
  })
})
