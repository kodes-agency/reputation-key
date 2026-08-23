import { describe, expect, it } from 'vitest'
import { INBOX_BULK_LIMIT } from '#/contexts/inbox/application/public-api'
import { inboxItemId } from '#/shared/domain/ids'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import {
  itemMatchesActiveFolder,
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

  it('matches status and active escalation folder semantics', () => {
    const item = {
      id: inboxItemId('00000000-0000-4000-8000-000000000001'),
      status: 'open',
      isEscalated: true,
      escalationResolvedAt: null,
    } as InboxItem
    expect(itemMatchesActiveFolder(item, { status: 'open' })).toBe(true)
    expect(itemMatchesActiveFolder(item, { status: 'closed' })).toBe(false)
    expect(itemMatchesActiveFolder(item, { isEscalated: true })).toBe(true)
    expect(
      itemMatchesActiveFolder(
        { ...item, escalationResolvedAt: new Date() },
        {
          isEscalated: true,
        },
      ),
    ).toBe(false)
  })
})
