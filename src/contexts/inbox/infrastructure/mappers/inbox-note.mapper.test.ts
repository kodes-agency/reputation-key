// Inbox context — inbox note mapper tests

import { describe, it, expect } from 'vitest'
import { inboxNoteFromRow, inboxNoteToInsertRow } from './inbox-note.mapper'
import type { inboxNotes } from '#/shared/db/schema/inbox.schema'

type InboxNoteRow = typeof inboxNotes.$inferSelect

const now = new Date('2025-06-01T12:00:00Z')

const sampleRow: InboxNoteRow = {
  id: 'note-uuid-001',
  inboxItemId: 'inbox-uuid-001',
  organizationId: 'org-uuid-001',
  userId: 'user-uuid-001',
  text: 'Follow up with guest',
  createdAt: now,
}

describe('inboxNoteFromRow', () => {
  it('brands IDs correctly', () => {
    const note = inboxNoteFromRow(sampleRow)
    expect(String(note.id)).toBe('note-uuid-001')
    expect(String(note.inboxItemId)).toBe('inbox-uuid-001')
    expect(String(note.organizationId)).toBe('org-uuid-001')
    expect(String(note.userId)).toBe('user-uuid-001')
  })

  it('maps all fields', () => {
    const note = inboxNoteFromRow(sampleRow)
    expect(note.text).toBe('Follow up with guest')
    expect(note.createdAt).toBe(now)
  })
})

describe('inboxNoteToInsertRow', () => {
  it('round-trips through fromRow → toInsertRow', () => {
    const note = inboxNoteFromRow(sampleRow)
    const row = inboxNoteToInsertRow(note)

    expect(row.id).toBe(sampleRow.id)
    expect(row.inboxItemId).toBe(sampleRow.inboxItemId)
    expect(row.organizationId).toBe(sampleRow.organizationId)
    expect(row.userId).toBe(sampleRow.userId)
    expect(row.text).toBe(sampleRow.text)
  })

  it('excludes createdAt', () => {
    const note = inboxNoteFromRow(sampleRow)
    const row = inboxNoteToInsertRow(note)
    expect('createdAt' in row).toBe(false)
  })
})
