import { describe, it, expect } from 'vitest'
import { addInboxNote } from './add-inbox-note'
import {
  inboxItemId,
  inboxNoteId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import { isInboxError } from '../../domain/errors'
import type { InboxItem, InboxNote, InboxStatus, SourceType } from '../../domain/types'
import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxNoteRepository } from '../ports/inbox-note.repository'

// ── In-memory repos ─────────────────────────────────────────────────
function createInMemoryInboxRepo(): InboxRepository & { items: InboxItem[] } {
  const items: InboxItem[] = []
  const repo: InboxRepository = {
    findById: async (id, orgId) => items.find(i => i.id === id && i.organizationId === orgId) ?? null,
    findBySource: async (sourceType, sourceId, orgId) =>
      items.find(i => i.sourceType === sourceType && i.sourceId === sourceId && i.organizationId === orgId) ?? null,
    findFilteredPaginated: async (filters, orgId, cursor, limit = 50) => {
      let filtered = items.filter(i => i.organizationId === orgId)
      if (filters.status) filtered = filtered.filter(i => i.status === filters.status)
      if (filters.propertyId) filtered = filtered.filter(i => i.propertyId === filters.propertyId)
      if (filters.sourceType) filtered = filtered.filter(i => i.sourceType === filters.sourceType)
      filtered.sort((a, b) => b.sourceDate.getTime() - a.sourceDate.getTime() || (b.id as string).localeCompare(a.id as string))
      if (cursor) {
        const idx = filtered.findIndex(i => i.sourceDate.getTime() === cursor.sourceDate.getTime() && i.id === cursor.id)
        filtered = idx >= 0 ? filtered.slice(idx + 1) : []
      }
      const sliced = filtered.slice(0, limit)
      const last = sliced[sliced.length - 1]
      return { items: sliced, nextCursor: last ? { sourceDate: last.sourceDate, id: last.id } : null }
    },
    create: async (item) => { items.push(item); return item },
    updateStatus: async (id, orgId, status, timestampFields) => {
      const item = items.find(i => i.id === id && i.organizationId === orgId)
      if (!item) throw new Error('not found')
      const idx = items.indexOf(item)
      items[idx] = { ...item, status, updatedAt: new Date(), ...timestampFields }
      return items[idx]
    },
    bulkUpdateStatus: async (ids, orgId, status, timestampFields) => {
      let updated = 0
      for (const id of ids) {
        const item = items.find(i => i.id === id && i.organizationId === orgId)
        if (item) {
          const idx = items.indexOf(item)
          items[idx] = { ...item, status, updatedAt: new Date(), ...timestampFields }
          updated++
        }
      }
      return { updated }
    },
    updateAssignment: async (id, orgId, assignedTo) => {
      const item = items.find(i => i.id === id && i.organizationId === orgId)
      if (!item) throw new Error('not found')
      const idx = items.indexOf(item)
      items[idx] = { ...item, assignedTo, updatedAt: new Date() }
      return items[idx]
    },
    countByStatus: async (orgId, status) => items.filter(i => i.organizationId === orgId && i.status === status).length,
    syncDenormalizedFields: async () => {},
    findDetailById: async (id, orgId) => {
      const item = items.find(i => i.id === id && i.organizationId === orgId)
      if (!item) return null
      return { item, reviewerName: null, reviewText: null, reviewerProfilePhotoUrl: null, feedbackComment: null, feedbackRatingValue: null }
    },
  }
  return { ...repo, items }
}

function createInMemoryNoteRepo(): InboxNoteRepository & { notes: InboxNote[] } {
  const notes: InboxNote[] = []
  const repo: InboxNoteRepository = {
    findByInboxItemId: async (itemId, orgId) => notes.filter(n => n.inboxItemId === itemId && n.organizationId === orgId),
    create: async (note) => { notes.push(note); return note },
  }
  return { ...repo, notes }
}

const FIXED_ID = inboxNoteId('note-1')
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const ITEM_ID = inboxItemId('ii-1')
const USER_ID = userId('user-1')

const seedItem = (): InboxItem => ({
  id: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: propertyId('prop-1'),
  sourceType: 'review' as SourceType,
  sourceId: reviewId('rev-1'),
  status: 'new' as InboxStatus,
  rating: 4,
  sourceDate: new Date('2026-04-10'),
  platform: 'google',
  snippet: 'Great!',
  assignedTo: null,
  readAt: null,
  escalatedAt: null,
  addressedAt: null,
  archivedAt: null,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
})

const setup = () => {
  const repo = createInMemoryInboxRepo()
  const noteRepo = createInMemoryNoteRepo()
  const deps = { repo, noteRepo, idGen: () => FIXED_ID, clock: () => FIXED_TIME }
  const useCase = addInboxNote(deps)
  return { useCase, repo, noteRepo }
}

describe('addInboxNote', () => {
  it('creates a note and persists it', async () => {
    const { useCase, repo, noteRepo } = setup()
    repo.items.push(seedItem())

    const note = await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      authorUserId: USER_ID,
      text: '  This is a note  ',
    })

    expect(note.id).toBe(FIXED_ID)
    expect(note.text).toBe('This is a note') // trimmed
    expect(note.authorUserId).toBe(USER_ID)
    expect(noteRepo.notes).toHaveLength(1)
  })

  it('throws error for empty text', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem())

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        authorUserId: USER_ID,
        text: '   ',
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isInboxError(e) && e.code === 'invalid_input',
    )
  })

  it('throws not_found when item does not exist', async () => {
    const { useCase } = setup()

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        authorUserId: USER_ID,
        text: 'A note',
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isInboxError(e) && e.code === 'not_found',
    )
  })
})
