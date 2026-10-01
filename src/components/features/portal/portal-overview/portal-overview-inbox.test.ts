import { describe, expect, it } from 'vitest'
import type { InboxPropertyCounts } from '#/contexts/inbox/application/public-api'
import {
  INBOX_WAITING_QUEUE,
  inboxWaitingCount,
  inboxWaitingLabel,
} from './portal-overview-inbox'

describe('inboxWaitingCount', () => {
  const counts: InboxPropertyCounts = {
    queue: 'open',
    total: 7,
    byProperty: { 'prop-1': 5, 'prop-2': 2 },
  }

  it('reads the Property’s own count from the open queue', () => {
    expect(inboxWaitingCount(counts, 'prop-1')).toBe(5)
    expect(inboxWaitingCount(counts, 'prop-2')).toBe(2)
  })

  it('reads a Property with nothing in the queue as zero, not as unknown', () => {
    expect(inboxWaitingCount(counts, 'prop-3')).toBe(0)
  })

  it('has no figure before the read, or when it failed', () => {
    expect(inboxWaitingCount(undefined, 'prop-1')).toBeNull()
  })

  it('counts the queue the link opens', () => {
    expect(INBOX_WAITING_QUEUE).toBe('open')
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
