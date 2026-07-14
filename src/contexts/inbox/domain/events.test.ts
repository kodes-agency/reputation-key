import { describe, it, expect } from 'vitest'

import { inboxItemCreated, inboxItemStatusChanged } from './events'
import { organizationId, propertyId, userId, inboxItemId } from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const USER_ID = userId('user-1')
const ITEM_ID = inboxItemId('item-1')
const NOW = new Date('2026-06-01T12:00:00Z')

describe('inbox events', () => {
  it('inboxItemCreated generates eventId', () => {
    const event = inboxItemCreated({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review',
      sourceId: 'rev-1' as unknown as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      rating: 5,
      snippet: 'test',
      userId: USER_ID,
      source: 'web',
      occurredAt: NOW,
    })
    expect(event.eventId).toBeDefined()
    expect(event._tag).toBe('inbox.inbox_item.created')
  })

  it('inboxItemStatusChanged works', () => {
    const event = inboxItemStatusChanged({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      oldStatus: 'open',
      newStatus: 'closed',
      userId: USER_ID,
      source: 'web',
      occurredAt: NOW,
    })
    expect(event._tag).toBe('inbox.inbox_item.status_changed')
  })
})
