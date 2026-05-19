import { describe, it, expect } from 'vitest'
import { getInboxNotes } from './get-inbox-notes'
import { inboxItemId, organizationId, userId, inboxNoteId } from '#/shared/domain/ids'
import type { InboxNote } from '../../domain/types'

function createInMemoryNoteRepo() {
  const notes: InboxNote[] = []
  const repo = {
    create: async (note: InboxNote) => {
      notes.push(note)
      return note
    },
    findByInboxItemId: async (inboxItemId: string, orgId: string) =>
      notes.filter((n) => n.inboxItemId === inboxItemId && n.organizationId === orgId),
  }
  return { ...repo, notes }
}

const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-2')
const ITEM_ID = inboxItemId('item-1')
const USER_ID = userId('user-1')
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')

describe('getInboxNotes', () => {
  it('returns notes for an inbox item', async () => {
    const noteRepo = createInMemoryNoteRepo()
    noteRepo.notes.push({
      id: inboxNoteId('note-1'),
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      authorUserId: USER_ID,
      text: 'Test note',
      createdAt: FIXED_TIME,
    })

    const useCase = getInboxNotes({ noteRepo })
    const result = await useCase({ inboxItemId: ITEM_ID, organizationId: ORG_ID })

    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('Test note')
  })

  it('returns empty array when no notes exist', async () => {
    const noteRepo = createInMemoryNoteRepo()
    const useCase = getInboxNotes({ noteRepo })
    const result = await useCase({ inboxItemId: ITEM_ID, organizationId: ORG_ID })

    expect(result).toHaveLength(0)
  })

  it('does not return notes from other organizations', async () => {
    const noteRepo = createInMemoryNoteRepo()
    noteRepo.notes.push({
      id: inboxNoteId('note-1'),
      inboxItemId: ITEM_ID,
      organizationId: OTHER_ORG_ID,
      authorUserId: USER_ID,
      text: 'Other org note',
      createdAt: FIXED_TIME,
    })

    const useCase = getInboxNotes({ noteRepo })
    const result = await useCase({ inboxItemId: ITEM_ID, organizationId: ORG_ID })

    expect(result).toHaveLength(0)
  })
})
