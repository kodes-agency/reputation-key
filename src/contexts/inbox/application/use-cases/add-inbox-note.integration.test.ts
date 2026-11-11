import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest'
import type { Pool } from 'pg'
import { addInboxNote } from './add-inbox-note'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  clearInboxUseCaseRows,
  createUseCaseCommandStore,
  createUseCaseDatabase,
  createUseCaseInboxRepository,
  dropInboxUseCaseOrganization,
  openFixturePool,
  readCommittedFacts,
} from '../../infrastructure/inbox-database-fixtures-use-cases'
import {
  seedInboxItem,
  seedInboxOrganization,
} from '../../infrastructure/inbox-database-fixtures'
import { createInboxNoteRepository } from '../../infrastructure/repositories/inbox-note.repository'
import {
  inboxItemId,
  inboxNoteId,
  organizationId,
  propertyId,
  reviewId,
  feedbackId,
  userId,
} from '#/shared/domain/ids'
import { isInboxError } from '../../domain/errors'
import type { InboxItem, SourceType } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { Role } from '#/shared/domain/roles'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'

const FIXED_ID = inboxNoteId('7b000000-0000-4000-8000-0000000000a1')
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-add-inbox-note-test')
const ITEM_ID = inboxItemId('7b000000-0000-4000-8000-000000000011')
const USER_ID = userId('user-1')
const PROP_1 = propertyId('7b000000-0000-4000-8000-000000000001')
const PROP_OTHER = propertyId('7b000000-0000-4000-8000-000000000002')
const REVIEW_ID = reviewId('7b000000-0000-4000-8000-000000000021')
const FEEDBACK_ID = feedbackId('7b000000-0000-4000-8000-000000000022')

const ctxFor = (role: Role): AuthContext =>
  ({ organizationId: ORG_ID, userId: USER_ID, role }) as AuthContext

const ctxWith = (...permissions: Permission[]): AuthContext => ({
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Member',
  effectivePermissions: new Set(permissions),
  scopeByPermission: new Map(
    permissions.map((permission) => [permission, 'organization' as const]),
  ),
})

const seedItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROP_1,
  sourceType: 'review' as SourceType,
  sourceId: REVIEW_ID,
  status: 'open',
  rating: 4,
  sourceDate: new Date('2026-04-10T00:00:00Z'),
  platform: 'google',
  snippet: 'Great!',
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
  commandRevision: 1,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  ...overrides,
})

const defaultStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

describe.sequential('addInboxNote', () => {
  const db = createUseCaseDatabase()
  let pool: Pool

  const setup = (peopleApi: StaffPublicApi = defaultStaffApi) => {
    const repo = createUseCaseInboxRepository(db, () => FIXED_TIME)
    const noteRepo = createInboxNoteRepository(db)
    const execute = addInboxNote({
      repo,
      commandStore: createUseCaseCommandStore(db, () => FIXED_TIME),
      idGen: () => FIXED_ID,
      clock: () => FIXED_TIME,
      staffPublicApi: peopleApi,
    })
    type CommandInput = Parameters<typeof execute>[0]
    const useCase = async (
      input: Omit<CommandInput, 'expectedCommandRevision'> &
        Partial<Pick<CommandInput, 'expectedCommandRevision'>>,
      ctx: AuthContext,
    ) =>
      execute(
        {
          ...input,
          expectedCommandRevision:
            input.expectedCommandRevision ??
            (await repo.findById(input.inboxItemId, ORG_ID))?.commandRevision ??
            1,
        },
        ctx,
      )
    const notes = () => noteRepo.findByInboxItemId(ITEM_ID, ORG_ID)
    const seed = (item: InboxItem) => seedInboxItem(pool, db, item, () => FIXED_TIME)
    return { useCase, repo, notes, seed }
  }

  beforeAll(async () => {
    pool = openFixturePool()
    clearEventSchemas()
    registerAllEventSchemas()
    await seedInboxOrganization(pool, ORG_ID, [PROP_1, PROP_OTHER])
  })

  beforeEach(() => clearInboxUseCaseRows(pool, ORG_ID))

  afterAll(async () => {
    clearEventSchemas()
    await dropInboxUseCaseOrganization(pool, ORG_ID)
    await pool.end()
  })

  it('creates a note and persists it', async () => {
    const { useCase, repo, notes, seed } = setup()
    await seed(seedItem())

    const note = await useCase(
      { inboxItemId: ITEM_ID, text: '  This is a note  ' },
      ctxFor('AccountAdmin'),
    )

    expect(note.id).toBe(FIXED_ID)
    expect(note.text).toBe('This is a note') // trimmed
    expect(note.userId).toBe(USER_ID)
    expect(await notes()).toHaveLength(1)
    expect((await repo.findById(ITEM_ID, ORG_ID))?.commandRevision).toBe(2)
  })

  it('throws error for empty text', async () => {
    const { useCase, seed } = setup()
    await seed(seedItem())

    await expect(
      useCase({ inboxItemId: ITEM_ID, text: '   ' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'invalid_input')
  })

  it('throws not_found when item does not exist', async () => {
    const { useCase } = setup()

    await expect(
      useCase({ inboxItemId: ITEM_ID, text: 'A note' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
  })

  it('denies access without inbox.write permission for inaccessible property', async () => {
    // Use a role not in the permission table to simulate lacking inbox.write
    const peopleApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
    }
    const { useCase, seed } = setup(peopleApi)
    await seed(seedItem())

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, text: 'test note' },
        ctxFor('Guest' as unknown as Role),
      ),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('denies Member note for an inaccessible Property', async () => {
    // Member is scoped to assigned Properties by Identity's access-grant authority.
    const peopleApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [PROP_OTHER],
      getAssignedPortals: async () => [],
    }
    const { useCase, seed } = setup(peopleApi)
    await seed(seedItem())

    await expect(
      useCase({ inboxItemId: ITEM_ID, text: 'test note' }, ctxFor('Member')),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('allows note when user has access to the property', async () => {
    const peopleApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [PROP_1],
      getAssignedPortals: async () => [],
    }
    const { useCase, notes, seed } = setup(peopleApi)
    await seed(seedItem())

    const note = await useCase(
      { inboxItemId: ITEM_ID, text: 'test note' },
      ctxFor('PropertyManager'),
    )

    expect(note.text).toBe('test note')
    expect(await notes()).toHaveLength(1)
  })

  it('records inbox.note.added in the outbox without note text', async () => {
    const { useCase, seed } = setup()
    await seed(seedItem())

    await useCase({ inboxItemId: ITEM_ID, text: 'hello' }, ctxFor('AccountAdmin'))

    const facts = await readCommittedFacts(pool, ORG_ID)
    expect(facts[0]!.eventType).toBe('inbox.inbox_note.added')
    expect(facts[0]!.payload).not.toHaveProperty('text')
  })

  it('requires feedback.handle, not only feedback.read, to add a private-feedback note', async () => {
    const { useCase, notes, seed } = setup()
    await seed(seedItem({ sourceType: 'feedback', sourceId: FEEDBACK_ID }))

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, text: 'Manager note' },
        ctxWith('inbox.write', 'feedback.read'),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
    expect(await notes()).toHaveLength(0)
  })

  it('allows a private-feedback note with inbox.write and feedback.handle', async () => {
    const { useCase, notes, seed } = setup()
    await seed(seedItem({ sourceType: 'feedback', sourceId: FEEDBACK_ID }))

    await useCase(
      { inboxItemId: ITEM_ID, text: 'Manager note' },
      ctxWith('inbox.write', 'feedback.handle'),
    )

    expect(await notes()).toHaveLength(1)
  })

  it('intersects feedback.handle property scope before adding a note', async () => {
    const peopleApi: StaffPublicApi = {
      ...defaultStaffApi,
      getAccessiblePropertyIds: async () => [PROP_OTHER],
    }
    const { useCase, notes, seed } = setup(peopleApi)
    await seed(seedItem({ sourceType: 'feedback', sourceId: FEEDBACK_ID }))

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, text: 'Manager note' },
        createScopedAuthContext({
          organizationId: ORG_ID,
          userId: USER_ID,
          permissions: [
            ['inbox.write', 'organization'],
            ['feedback.handle', 'assigned-properties'],
          ],
        }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
    expect(await notes()).toHaveLength(0)
  })
})
