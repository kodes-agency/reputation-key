// Inbox context — inbox item mapper tests

import { describe, it, expect } from 'vitest'
import { inboxItemFromRow, inboxItemToInsertRow } from './inbox.mapper'
import type { inboxItems } from '#/shared/db/schema/inbox.schema'

type InboxItemRow = typeof inboxItems.$inferSelect

const now = new Date('2025-06-01T12:00:00Z')
const sourceDate = new Date('2025-05-27T10:00:00Z')
const readAt = new Date('2025-05-28T08:00:00Z')

const sampleRow: InboxItemRow = {
  id: 'inbox-uuid-001',
  organizationId: 'org-uuid-001',
  propertyId: 'prop-uuid-001',
  sourceType: 'review',
  sourceId: 'source-uuid-001',
  status: 'new',
  rating: 4,
  sourceDate,
  platform: 'google',
  snippet: 'Great service!',
  reviewerName: null,
  assignedTo: 'user-uuid-001',
  readAt,
  escalatedAt: null,
  addressedAt: null,
  archivedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  createdAt: now,
  updatedAt: now,
}

describe('inboxItemFromRow', () => {
  it('brands IDs correctly', () => {
    const item = inboxItemFromRow(sampleRow)
    expect(String(item.id)).toBe('inbox-uuid-001')
    expect(String(item.organizationId)).toBe('org-uuid-001')
    expect(String(item.propertyId)).toBe('prop-uuid-001')
    expect(String(item.assignedTo)).toBe('user-uuid-001')
  })

  it('maps all fields', () => {
    const item = inboxItemFromRow(sampleRow)
    expect(item.sourceType).toBe('review')
    expect(item.sourceId).toBe('source-uuid-001')
    expect(item.status).toBe('new')
    expect(item.rating).toBe(4)
    expect(item.sourceDate).toBe(sourceDate)
    expect(item.platform).toBe('google')
    expect(item.snippet).toBe('Great service!')
    expect(item.readAt).toBe(readAt)
    expect(item.escalatedAt).toBeNull()
    expect(item.addressedAt).toBeNull()
    expect(item.archivedAt).toBeNull()
    expect(item.createdAt).toBe(now)
    expect(item.updatedAt).toBe(now)
  })

  it('handles null assignedTo', () => {
    const row = { ...sampleRow, assignedTo: null }
    const item = inboxItemFromRow(row)
    expect(item.assignedTo).toBeNull()
  })

  it('handles null optional fields', () => {
    const row: InboxItemRow = {
      ...sampleRow,
      rating: null,
      platform: null,
      snippet: null,
      readAt: null,
    }
    const item = inboxItemFromRow(row)
    expect(item.rating).toBeNull()
    expect(item.platform).toBeNull()
    expect(item.snippet).toBeNull()
    expect(item.readAt).toBeNull()
  })
})

describe('inboxItemToInsertRow', () => {
  it('round-trips through fromRow → toInsertRow', () => {
    const item = inboxItemFromRow(sampleRow)
    const fullItem = { ...item, reviewerName: null, propertyName: null }
    const row = inboxItemToInsertRow(fullItem)

    expect(row.id).toBe(sampleRow.id)
    expect(row.organizationId).toBe(sampleRow.organizationId)
    expect(row.propertyId).toBe(sampleRow.propertyId)
    expect(row.sourceType).toBe(sampleRow.sourceType)
    expect(row.sourceId).toBe(sampleRow.sourceId)
    expect(row.status).toBe(sampleRow.status)
    expect(row.rating).toBe(sampleRow.rating)
    expect(row.sourceDate).toBe(sampleRow.sourceDate)
    expect(row.platform).toBe(sampleRow.platform)
    expect(row.snippet).toBe(sampleRow.snippet)
    expect(row.assignedTo).toBe(sampleRow.assignedTo)
    expect(row.readAt).toBe(sampleRow.readAt)
    expect(row.escalatedAt).toBe(sampleRow.escalatedAt)
    expect(row.addressedAt).toBe(sampleRow.addressedAt)
    expect(row.archivedAt).toBe(sampleRow.archivedAt)
  })

  it('excludes createdAt and updatedAt', () => {
    const item = inboxItemFromRow(sampleRow)
    const fullItem = { ...item, reviewerName: null, propertyName: null }
    const row = inboxItemToInsertRow(fullItem)
    expect('createdAt' in row).toBe(false)
    expect('updatedAt' in row).toBe(false)
  })

  it('round-trips null assignedTo (fromRow → toInsertRow)', () => {
    const rowWithNull = { ...sampleRow, assignedTo: null }
    const item = inboxItemFromRow(rowWithNull)
    expect(item.assignedTo).toBeNull()

    const fullItem = { ...item, reviewerName: null, propertyName: null }
    const row = inboxItemToInsertRow(fullItem)
    expect(row.assignedTo).toBeNull()
  })

  it('round-trips non-null assignedTo (fromRow → toInsertRow)', () => {
    const item = inboxItemFromRow(sampleRow)
    expect(item.assignedTo).not.toBeNull()
    expect(String(item.assignedTo)).toBe('user-uuid-001')

    const fullItem = { ...item, reviewerName: null, propertyName: null }
    const row = inboxItemToInsertRow(fullItem)
    expect(row.assignedTo).toBe('user-uuid-001')
  })
})
