import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import { inboxKeys } from '#/shared/queries/query-keys'
import { BULLMQ_ACTIVITY_LAG_MS } from './inbox-cache-policy'
import {
  GOOGLE_REPLY_CLOSE_REREAD_DELAYS_MS,
  rereadAfterGoogleReplyFound,
} from './inbox-google-check-cache'

const ID = 'item-1'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function recordingClient() {
  const calls: Array<{ queryKey: ReadonlyArray<unknown>; exact?: boolean }> = []
  const qc = {
    invalidateQueries: (filters: {
      queryKey: ReadonlyArray<unknown>
      exact?: boolean
    }) => {
      calls.push(filters)
      return Promise.resolve()
    },
  } as unknown as QueryClient
  const reads = (key: ReadonlyArray<unknown>) =>
    calls.filter((call) => JSON.stringify(call.queryKey) === JSON.stringify(key))
  return { qc, calls, reads }
}

describe('rereadAfterGoogleReplyFound', () => {
  it('re-reads the item at once and after the worker lag, and nothing else yet', () => {
    const { qc, calls, reads } = recordingClient()

    rereadAfterGoogleReplyFound(qc, ID)
    vi.advanceTimersByTime(0)
    expect(reads(inboxKeys.detail(ID))).toHaveLength(1)

    vi.advanceTimersByTime(BULLMQ_ACTIVITY_LAG_MS)
    expect(reads(inboxKeys.detail(ID))).toHaveLength(2)
    expect(calls).toHaveLength(2)
  })

  it('re-reads the thread and the folders with the last read of the item', () => {
    const { qc, reads } = recordingClient()

    rereadAfterGoogleReplyFound(qc, ID)
    vi.advanceTimersByTime(Math.max(...GOOGLE_REPLY_CLOSE_REREAD_DELAYS_MS))

    expect(reads(inboxKeys.detail(ID))).toHaveLength(3)
    expect(reads(inboxKeys.history(ID))).toHaveLength(1)
    expect(reads(inboxKeys.lists())).toHaveLength(1)
    expect(reads(inboxKeys.counts())).toHaveLength(1)
    expect(reads(inboxKeys.lastVisitCount())).toHaveLength(1)
  })

  it('reads the item exactly, so its notes and history are not dragged along', () => {
    const { qc, reads } = recordingClient()

    rereadAfterGoogleReplyFound(qc, ID)
    vi.advanceTimersByTime(Math.max(...GOOGLE_REPLY_CLOSE_REREAD_DELAYS_MS))

    expect(reads(inboxKeys.detail(ID)).every((call) => call.exact === true)).toBe(true)
  })
})
