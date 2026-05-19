import { describe, it, expect } from 'vitest'
import { addInboxNote } from './add-inbox-note'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import {
  inboxItemId,
  inboxNoteId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import { isInboxError } from '../../domain/errors'
import type { InboxNote, InboxStatus, SourceType } from '../../domain/types'
import type { InboxItem } from '../../domain/types'
import type { InboxNoteRepository } from '../ports/inbox-note.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'

function createInMemoryNoteRepo(): InboxNoteRepository & { notes: InboxNote[] } {
  const notes: InboxNote[] = []
  const repo: InboxNoteRepository = {
    findByInboxItemId: async (itemId, orgId) =>
      notes.filter((n) => n.inboxItemId === itemId && n.organizationId === orgId),
    create: async (note) => {
      notes.push(note)
      return note
    },
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

const defaultStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
}

const setup = (staffApi: StaffPublicApi = defaultStaffApi) => {
  const repo = createInMemoryInboxRepo()
  const noteRepo = createInMemoryNoteRepo()
  const deps = {
    repo,
    noteRepo,
    idGen: () => FIXED_ID,
    clock: () => FIXED_TIME,
    staffPublicApi: staffApi,
  }
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
      role: 'AccountAdmin' as Role,
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
        role: 'AccountAdmin' as Role,
      }),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'invalid_input')
  })

  it('throws not_found when item does not exist', async () => {
    const { useCase } = setup()

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        authorUserId: USER_ID,
        text: 'A note',
        role: 'AccountAdmin' as Role,
      }),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
  })

  it('throws forbidden when non-admin adds note for inaccessible property', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-other')],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem())

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        authorUserId: USER_ID,
        text: 'test note',
        role: 'Staff' as Role,
      }),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('allows note when user has access to the property', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
    }
    const { useCase, repo, noteRepo } = setup(staffApi)
    repo.items.push(seedItem())

    const note = await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      authorUserId: USER_ID,
      text: 'test note',
      role: 'Staff' as Role,
    })

    expect(note.text).toBe('test note')
    expect(noteRepo.notes).toHaveLength(1)
  })
})
