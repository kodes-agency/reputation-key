import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { InboxPropertyCounts } from '#/contexts/inbox/application/public-api'
import { inboxKeys } from '#/shared/queries/query-keys'
import {
  INBOX_WAITING_QUEUE,
  inboxWaitingCount,
  inboxWaitingFor,
  inboxWaitingLabel,
  inboxWaitingQuery,
} from './portal-overview-inbox'

describe('inboxWaitingCount', () => {
  const counts: InboxPropertyCounts = {
    queue: 'feedback',
    total: 7,
    byProperty: { 'prop-1': 5, 'prop-2': 2 },
  }

  it('reads the Property’s own count from the private feedback queue', () => {
    expect(inboxWaitingCount(counts, 'prop-1')).toBe(5)
    expect(inboxWaitingCount(counts, 'prop-2')).toBe(2)
  })

  it('reads a Property with nothing in the queue as zero, not as unknown', () => {
    expect(inboxWaitingCount(counts, 'prop-3')).toBe(0)
  })

  it('has no figure before the read, or when it failed', () => {
    expect(inboxWaitingCount(undefined, 'prop-1')).toBeNull()
  })

  it('counts the private feedback queue, the one the Private notes cell is about', () => {
    expect(INBOX_WAITING_QUEUE).toBe('feedback')
  })
})

describe('inboxWaitingFor', () => {
  const counts: InboxPropertyCounts = {
    queue: 'feedback',
    total: 3,
    byProperty: { 'prop-1': 3 },
  }

  it('gives the count to a reader who may open the Inbox', () => {
    expect(inboxWaitingFor(true, counts, 'prop-1')).toBe(3)
    expect(inboxWaitingFor(true, counts, 'prop-2')).toBe(0)
  })

  it('gives nothing to a reader who may not, even when the cache holds a count', () => {
    expect(inboxWaitingFor(false, counts, 'prop-1')).toBeNull()
  })

  it('gives nothing while the read has not answered', () => {
    expect(inboxWaitingFor(true, undefined, 'prop-1')).toBeNull()
  })
})

describe('inboxWaitingQuery', () => {
  const counts: InboxPropertyCounts = {
    queue: 'feedback',
    total: 3,
    byProperty: { 'prop-1': 3 },
  }

  function observe(
    mayOpenInbox: boolean,
    fetchCounts: () => Promise<InboxPropertyCounts>,
  ) {
    const client = new QueryClient()
    const observer = new QueryObserver(
      client,
      inboxWaitingQuery(mayOpenInbox, fetchCounts),
    )
    const stop = observer.subscribe(() => undefined)
    return { observer, stop, client }
  }

  it('never calls the server for a reader without inbox.manage', () => {
    const fetchCounts = vi.fn(() => Promise.resolve(counts))
    const { observer, stop, client } = observe(false, fetchCounts)
    expect(fetchCounts).not.toHaveBeenCalled()
    expect(observer.getCurrentResult().data).toBeUndefined()
    stop()
    client.clear()
  })

  it('reads the feedback queue, under the key the Inbox rail shares, when allowed', async () => {
    const fetchCounts = vi.fn(() => Promise.resolve(counts))
    const { observer, stop, client } = observe(true, fetchCounts)
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(counts))
    expect(fetchCounts).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(inboxKeys.propertyCountsFor('feedback'))).toEqual(counts)
    stop()
    client.clear()
  })

  it('leaves no data, and does not retry, when the read fails', async () => {
    const fetchCounts = vi.fn(() => Promise.reject(new Error('down')))
    const { observer, stop, client } = observe(true, fetchCounts)
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true))
    expect(fetchCounts).toHaveBeenCalledTimes(1)
    expect(inboxWaitingFor(true, observer.getCurrentResult().data, 'prop-1')).toBeNull()
    stop()
    client.clear()
  })
})

describe('inboxWaitingLabel', () => {
  it('words the count, singular and plural', () => {
    expect(inboxWaitingLabel(1)).toBe('1 waiting in Inbox')
    expect(inboxWaitingLabel(12)).toBe('12 waiting in Inbox')
  })

  it('says nothing when nothing waits or the count is unknown', () => {
    expect(inboxWaitingLabel(0)).toBeNull()
    expect(inboxWaitingLabel(null)).toBeNull()
  })
})
