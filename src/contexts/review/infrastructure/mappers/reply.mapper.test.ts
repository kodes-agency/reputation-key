// Review context — reply mapper tests

import { describe, it, expect } from 'vitest'
import { replyFromRow, replyToRow } from './reply.mapper'
import type { replies } from '#/shared/db/schema/review.schema'

type ReplyRow = typeof replies.$inferSelect

const now = new Date('2025-06-01T12:00:00Z')
const publishedAt = new Date('2025-05-30T10:00:00Z')

const sampleRow: ReplyRow = {
  id: 'reply-uuid-001',
  reviewId: 'rev-uuid-001',
  organizationId: 'org-uuid-001',
  text: 'Thank you for your feedback!',
  status: 'published',
  source: 'google_sync',
  createdBy: null,
  approvedBy: null,
  rejectedBy: null,
  rejectionReason: null,
  aiGenerated: false,
  publishedAt,
  createdAt: now,
  updatedAt: now,
}

describe('replyFromRow', () => {
  it('brands IDs correctly', () => {
    const reply = replyFromRow(sampleRow)
    expect(String(reply.id)).toBe('reply-uuid-001')
    expect(String(reply.reviewId)).toBe('rev-uuid-001')
    expect(String(reply.organizationId)).toBe('org-uuid-001')
  })

  it('maps all fields', () => {
    const reply = replyFromRow(sampleRow)
    expect(reply.text).toBe('Thank you for your feedback!')
    expect(reply.status).toBe('published')
    expect(reply.source).toBe('google_sync')
    expect(reply.createdBy).toBeNull()
    expect(reply.approvedBy).toBeNull()
    expect(reply.rejectedBy).toBeNull()
    expect(reply.rejectionReason).toBeNull()
    expect(reply.aiGenerated).toBe(false)
    expect(reply.publishedAt).toBe(publishedAt)
    expect(reply.createdAt).toBe(now)
    expect(reply.updatedAt).toBe(now)
  })

  it('handles internal source with createdBy', () => {
    const row: ReplyRow = {
      ...sampleRow,
      source: 'internal',
      createdBy: 'user-uuid-001',
      status: 'draft',
      publishedAt: null,
    }
    const reply = replyFromRow(row)
    expect(reply.source).toBe('internal')
    expect(reply.createdBy).toBe('user-uuid-001')
    expect(reply.status).toBe('draft')
    expect(reply.publishedAt).toBeNull()
  })
})

describe('replyToRow', () => {
  it('round-trips through fromRow → toRow', () => {
    const reply = replyFromRow(sampleRow)
    const row = replyToRow(reply)

    expect(row.id).toBe(sampleRow.id)
    expect(row.reviewId).toBe(sampleRow.reviewId)
    expect(row.organizationId).toBe(sampleRow.organizationId)
    expect(row.text).toBe(sampleRow.text)
    expect(row.status).toBe(sampleRow.status)
    expect(row.source).toBe(sampleRow.source)
    expect(row.createdBy).toBe(sampleRow.createdBy)
    expect(row.approvedBy).toBe(sampleRow.approvedBy)
    expect(row.rejectedBy).toBe(sampleRow.rejectedBy)
    expect(row.rejectionReason).toBe(sampleRow.rejectionReason)
    expect(row.aiGenerated).toBe(sampleRow.aiGenerated)
    expect(row.publishedAt).toBe(sampleRow.publishedAt)
  })

  it('excludes createdAt and updatedAt', () => {
    const reply = replyFromRow(sampleRow)
    const row = replyToRow(reply)
    expect('createdAt' in row).toBe(false)
    expect('updatedAt' in row).toBe(false)
  })
})
