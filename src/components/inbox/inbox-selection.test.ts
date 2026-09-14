import { describe, expect, it } from 'vitest'
import { INBOX_BULK_LIMIT } from '#/contexts/inbox/application/public-api'
import { inboxItemId } from '#/shared/domain/ids'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import {
  itemMatchesQueue,
  removeInboxSelection,
  toggleInboxSelection,
} from './inbox-selection'

describe('toggleInboxSelection', () => {
  it('adds and removes selected IDs', () => {
    expect(toggleInboxSelection([], 'review-1')).toEqual(['review-1'])
    expect(toggleInboxSelection(['review-1'], 'review-1')).toEqual([])
  })

  it('keeps the server bulk limit while allowing deselection', () => {
    const atLimit = Array.from(
      { length: INBOX_BULK_LIMIT },
      (_, index) => `review-${index}`,
    )

    expect(toggleInboxSelection(atLimit, 'review-over-limit')).toBe(atLimit)
    expect(toggleInboxSelection(atLimit, 'review-0')).toHaveLength(INBOX_BULK_LIMIT - 1)
  })
})

describe('selection reconciliation', () => {
  it('removes a selected row after it leaves the active folder', () => {
    expect(removeInboxSelection(['one', 'two'], 'one')).toEqual(['two'])
    expect(removeInboxSelection(['two'], 'missing')).toEqual(['two'])
  })

  it('matches all queue semantics', () => {
    const item = {
      id: inboxItemId('00000000-0000-4000-8000-000000000001'),
      status: 'open',
      sourceType: 'review',
      assignedTo: null,
      isEscalated: true,
      escalationResolvedAt: null,
    } as InboxItem
    const mine = { ...item, assignedTo: 'viewer' } as InboxItem
    const feedback = { ...item, sourceType: 'feedback' } as InboxItem
    const approval = {
      ...item,
      replyState: { status: 'pending_approval' },
    } as InboxItem
    const waiting = { ...item, replyState: { status: 'approved' } } as InboxItem
    expect(itemMatchesQueue(item, 'reply', 'viewer')).toBe(true)
    expect(itemMatchesQueue(approval, 'approval', 'viewer')).toBe(true)
    expect(itemMatchesQueue(waiting, 'waiting', 'viewer')).toBe(true)
    expect(itemMatchesQueue(feedback, 'feedback', 'viewer')).toBe(true)
    expect(itemMatchesQueue(item, 'escalated', 'viewer')).toBe(true)
    expect(itemMatchesQueue(mine, 'mine', 'viewer')).toBe(true)
    expect(itemMatchesQueue({ ...item, status: 'closed' }, 'closed', 'viewer')).toBe(true)
    expect(itemMatchesQueue(item, 'open', 'viewer')).toBe(true)
    expect(
      itemMatchesQueue(
        { ...item, escalationResolvedAt: new Date() },
        'escalated',
        'viewer',
      ),
    ).toBe(false)
  })
})
