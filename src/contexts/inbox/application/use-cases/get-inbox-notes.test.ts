import { describe, it, expect } from 'vitest'
import { getInboxNotes } from './get-inbox-notes'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import {
  inboxItemId,
  organizationId,
  userId,
  inboxNoteId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import type { InboxNote, InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'
import type { AuthContext } from '#/shared/domain/auth-context'
import { isInboxError } from '../../domain/errors'

const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-2')
const ITEM_ID = inboxItemId('item-1')
const PROP_ID = propertyId('prop-1')
const USER_ID = userId('user-1')
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')

const adminStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
}

const createScopedStaffApi = (ids: ReadonlyArray<string>): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids.map(propertyId),
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const makeItem = (): InboxItem => ({
  id: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  sourceType: 'review' as SourceType,
  sourceId: reviewId('rev-1'),
  status: 'new' as InboxStatus,
  rating: 4,
  sourceDate: FIXED_TIME,
  platform: 'google',
  snippet: 'Test',
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
})

function createInMemoryNoteRepo() {
  const notes: InboxNote[] = []
  const noteRepo = {
    create: async (note: InboxNote) => {
      notes.push(note)
      return note
    },
    findByInboxItemId: async (iid: string, orgId: string) =>
      notes.filter((n) => n.inboxItemId === iid && n.organizationId === orgId),
  }
  return { ...noteRepo, notes }
}

const ctxFor = (role: Role): AuthContext =>
  ({ organizationId: ORG_ID, userId: USER_ID, role }) as AuthContext

describe('getInboxNotes', () => {
  it('returns notes for an inbox item', async () => {
    const noteRepo = createInMemoryNoteRepo()
    noteRepo.notes.push({
      id: inboxNoteId('note-1'),
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      text: 'Test note',
      createdAt: FIXED_TIME,
    })
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem())

    const useCase = getInboxNotes({ noteRepo, repo, staffPublicApi: adminStaffApi })
    const result = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('Test note')
  })

  it('returns empty array when no notes exist', async () => {
    const noteRepo = createInMemoryNoteRepo()
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem())

    const useCase = getInboxNotes({ noteRepo, repo, staffPublicApi: adminStaffApi })
    const result = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(result).toHaveLength(0)
  })

  it('does not return notes from other organizations', async () => {
    const noteRepo = createInMemoryNoteRepo()
    noteRepo.notes.push({
      id: inboxNoteId('note-1'),
      inboxItemId: ITEM_ID,
      organizationId: OTHER_ORG_ID,
      userId: USER_ID,
      text: 'Other org note',
      createdAt: FIXED_TIME,
    })
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem())

    const useCase = getInboxNotes({ noteRepo, repo, staffPublicApi: adminStaffApi })
    const result = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(result).toHaveLength(0)
  })

  it('denies access without inbox.read permission for inaccessible property', async () => {
    // Use a role not in the permission table to simulate lacking inbox.read
    const noteRepo = createInMemoryNoteRepo()
    const scopedApi = createScopedStaffApi([])
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem())

    const useCase = getInboxNotes({ noteRepo, repo, staffPublicApi: scopedApi })
    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxFor('Guest' as unknown as Role)),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    // PM holds inbox.read/inbox.manage, but per CONTEXT.md L72 PM only manages
    // ASSIGNED properties — assertPropertyAccessible enforces the scope.
    const noteRepo = createInMemoryNoteRepo()
    const scopedApi = createScopedStaffApi(['other-prop'])
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem()) // item is on PROP_ID (prop-1); PM NOT assigned

    const useCase = getInboxNotes({ noteRepo, repo, staffPublicApi: scopedApi })
    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxFor('PropertyManager')),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('allows PropertyManager to read notes for an assigned property', async () => {
    const noteRepo = createInMemoryNoteRepo()
    noteRepo.notes.push({
      id: inboxNoteId('note-1'),
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      text: 'PM-visible note',
      createdAt: FIXED_TIME,
    })
    const scopedApi = createScopedStaffApi(['prop-1']) // PM assigned to prop-1
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem()) // item on prop-1

    const useCase = getInboxNotes({ noteRepo, repo, staffPublicApi: scopedApi })
    const result = await useCase({ inboxItemId: ITEM_ID }, ctxFor('PropertyManager'))

    expect(result).toHaveLength(1)
    expect(result[0]!.text).toBe('PM-visible note')
  })
})
