import { describe, expect, it } from 'vitest'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { inboxRowView } from './inbox-list-row-view'

const item = {
  sourceType: 'review',
  status: 'open',
  reviewerName: 'Grace Hopper',
  sourceDate: new Date('2026-09-14T10:00:00Z'),
  createdAt: new Date('2026-09-14T11:00:00Z'),
  snippet: 'A thoughtful review',
  contentAvailability: 'text',
  assignedTo: 'viewer',
  isEscalated: true,
  escalationResolvedAt: null,
  attention: 'urgent',
  replyState: {
    status: 'pending_approval',
    publicationState: null,
    publicationLastErrorClass: null,
    updatedAt: new Date('2026-09-14T10:00:00Z'),
  },
} as unknown as InboxItem

describe('inboxRowView', () => {
  it('orders accessible signals and resolves the owner without ids', () => {
    const view = inboxRowView(item, {
      currentUser: { id: 'viewer', name: 'Grace Hopper' },
      assignmentOptions: [],
      viewedUpTo: new Date('2026-09-14T09:00:00Z'),
      now: new Date('2026-09-14T12:00:00Z'),
    })
    expect(view.accessibleName).toBe(
      'Open review from Grace Hopper, Awaiting approval, Escalated, Urgent, new',
    )
    expect(view.owner).toEqual({ label: 'You', initials: 'GH', isAssigned: true })
    expect(view.age).toBe('2h')
  })

  it('uses governed fallback copy and no new marker on first visit', () => {
    const view = inboxRowView(
      { ...item, snippet: null, contentAvailability: 'rating_only' },
      { assignmentOptions: [], viewedUpTo: null },
    )
    expect(view.content).toBe('Rating only — the guest left no text')
    expect(view.isNew).toBe(false)
  })
})
