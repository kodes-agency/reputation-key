import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest'
import { Pool } from 'pg'
import { getInboxNotes } from './get-inbox-notes'
import { getEnv } from '#/shared/config/env'
import {
  inboxItemId,
  organizationId,
  userId,
  inboxNoteId,
  propertyId,
  reviewId,
  feedbackId,
} from '#/shared/domain/ids'
import type { InboxNote, InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { Role } from '#/shared/domain/roles'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import { isInboxError } from '../../domain/errors'
import type { Permission } from '#/shared/domain/permissions'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import { seedInboxOrganization } from '../../infrastructure/inbox-database-fixtures'
import {
  clearInboxOrganization,
  createInboxUseCaseDatabase,
  dropInboxOrganization,
} from '../../infrastructure/inbox-database-fixtures-use-cases-slice'

const ORG_ID = organizationId('org-inbox-notes-test')
const OTHER_ORG_ID = organizationId('org-inbox-notes-other')
const ITEM_ID = inboxItemId('94a20000-0000-4000-8000-000000000001')
const PROP_ID = propertyId('94a20000-0000-4000-8000-0000000000a1')
const USER_ID = userId('user-1')
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')

const adminStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const createScopedStaffApi = (ids: ReadonlyArray<string>): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids.map(propertyId),
  getAssignedPortals: async () => [],
})

const makeItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  sourceType: 'review' as SourceType,
  sourceId: reviewId('94a20000-0000-4000-8000-0000000000b1'),
  status: 'open' as InboxStatus,
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
  commandRevision: 1,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  ...overrides,
})

let pool: Pool
let noteRepo: ReturnType<typeof createInboxUseCaseDatabase>['noteRepo']
let repo: ReturnType<typeof createInboxUseCaseDatabase>['repo']
let seed: ReturnType<typeof createInboxUseCaseDatabase>['seed']

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  ;({ noteRepo, repo, seed } = createInboxUseCaseDatabase(pool, () => FIXED_TIME))
  await seedInboxOrganization(pool, ORG_ID, [PROP_ID])
})

beforeEach(() => clearInboxOrganization(pool, ORG_ID))

afterAll(async () => {
  await dropInboxOrganization(pool, ORG_ID)
  await pool.end()
})

const addNote = (note: InboxNote) => noteRepo.create(note, note.organizationId)

/**
 * IBX-01-T6: a counting directory double. Every test asserts the lookup happens
 * exactly once per request, so an N+1 regression fails loudly rather than
 * quietly costing one query per note.
 */
function createCountingActorDirectory(
  names: ReadonlyMap<string, string> = new Map([[USER_ID as string, 'Ada Lovelace']]),
) {
  const calls: ReadonlyArray<string>[] = []
  return {
    calls,
    resolveDisplayNames: async (
      _organizationId: OrganizationId,
      userIds: readonly UserId[],
    ) => {
      calls.push(userIds.map(String))
      return new Map(
        userIds.flatMap((id) => {
          const name = names.get(String(id))
          return name === undefined ? [] : [[id, name] as const]
        }),
      )
    },
  }
}

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

describe.sequential('getInboxNotes', () => {
  it('returns notes for an inbox item', async () => {
    await seed(makeItem())
    await addNote({
      id: inboxNoteId(crypto.randomUUID()),
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      text: 'Test note',
      createdAt: FIXED_TIME,
    })

    const useCase = getInboxNotes({
      noteRepo,
      repo,
      staffPublicApi: adminStaffApi,
      actorDirectory: createCountingActorDirectory(),
    })
    const result = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('Test note')
  })

  it('returns empty array when no notes exist', async () => {
    await seed(makeItem())

    const useCase = getInboxNotes({
      noteRepo,
      repo,
      staffPublicApi: adminStaffApi,
      actorDirectory: createCountingActorDirectory(),
    })
    const result = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(result).toHaveLength(0)
  })

  it('does not return notes from other organizations', async () => {
    await seed(makeItem())
    await addNote({
      id: inboxNoteId(crypto.randomUUID()),
      inboxItemId: ITEM_ID,
      organizationId: OTHER_ORG_ID,
      userId: USER_ID,
      text: 'Other org note',
      createdAt: FIXED_TIME,
    })

    const useCase = getInboxNotes({
      noteRepo,
      repo,
      staffPublicApi: adminStaffApi,
      actorDirectory: createCountingActorDirectory(),
    })
    const result = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(result).toHaveLength(0)
  })

  it('denies access without inbox.read permission for inaccessible property', async () => {
    // Use a role not in the permission table to simulate lacking inbox.read
    const scopedApi = createScopedStaffApi([])
    await seed(makeItem())

    const useCase = getInboxNotes({
      noteRepo,
      repo,
      staffPublicApi: scopedApi,
      actorDirectory: createCountingActorDirectory(),
    })
    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxFor('Guest' as unknown as Role)),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    // PM holds inbox.read/inbox.manage, but per CONTEXT.md L72 PM only manages
    // ASSIGNED properties — assertPropertyAccessible enforces the scope.
    const scopedApi = createScopedStaffApi(['other-prop'])
    await seed(makeItem()) // item is on PROP_ID (prop-1); PM NOT assigned

    const useCase = getInboxNotes({
      noteRepo,
      repo,
      staffPublicApi: scopedApi,
      actorDirectory: createCountingActorDirectory(),
    })
    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxFor('PropertyManager')),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('allows PropertyManager to read notes for an assigned property', async () => {
    await seed(makeItem()) // item on prop-1
    await addNote({
      id: inboxNoteId(crypto.randomUUID()),
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      text: 'PM-visible note',
      createdAt: FIXED_TIME,
    })
    const scopedApi = createScopedStaffApi([PROP_ID]) // PM assigned to prop-1

    const useCase = getInboxNotes({
      noteRepo,
      repo,
      staffPublicApi: scopedApi,
      actorDirectory: createCountingActorDirectory(),
    })
    const result = await useCase({ inboxItemId: ITEM_ID }, ctxFor('PropertyManager'))

    expect(result).toHaveLength(1)
    expect(result[0]!.text).toBe('PM-visible note')
  })

  it('does not expose notes attached to private feedback without feedback.read', async () => {
    await seed(
      makeItem({
        sourceType: 'feedback',
        sourceId: feedbackId('94a20000-0000-4000-8000-0000000000b2'),
      }),
    )

    const useCase = getInboxNotes({
      noteRepo,
      repo,
      staffPublicApi: adminStaffApi,
      actorDirectory: createCountingActorDirectory(),
    })

    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxWith('inbox.read', 'review.read')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
  })

  it('intersects feedback.read property scope before returning notes', async () => {
    await seed(
      makeItem({
        sourceType: 'feedback',
        sourceId: feedbackId('94a20000-0000-4000-8000-0000000000b2'),
      }),
    )
    const useCase = getInboxNotes({
      noteRepo,
      repo,
      staffPublicApi: createScopedStaffApi(['other-prop']),
      actorDirectory: createCountingActorDirectory(),
    })

    await expect(
      useCase(
        { inboxItemId: ITEM_ID },
        createScopedAuthContext({
          organizationId: ORG_ID,
          userId: USER_ID,
          permissions: [
            ['inbox.read', 'organization'],
            ['feedback.read', 'assigned-properties'],
          ],
        }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
  })
})

describe.sequential('getInboxNotes actor display names (IBX-01-T6)', () => {
  const seedNote = (index: number, author: string) =>
    addNote({
      id: inboxNoteId(crypto.randomUUID()),
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: userId(author),
      text: `note ${index}`,
      createdAt: FIXED_TIME,
    })

  it('carries the resolved display name on every returned note', async () => {
    await seed(makeItem())
    await seedNote(1, USER_ID)
    const actorDirectory = createCountingActorDirectory()

    const result = await getInboxNotes({
      noteRepo,
      repo,
      staffPublicApi: adminStaffApi,
      actorDirectory,
    })({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(result).toEqual([expect.objectContaining({ displayName: 'Ada Lovelace' })])
  })

  it('yields displayName null for a deleted or unknown author', async () => {
    await seed(makeItem())
    await seedNote(1, 'user-departed')

    const result = await getInboxNotes({
      noteRepo,
      repo,
      staffPublicApi: adminStaffApi,
      actorDirectory: createCountingActorDirectory(),
    })({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    // Null, never the raw id: the component renders "Unknown user".
    expect(result[0].displayName).toBeNull()
    expect(result[0].userId).toBe('user-departed')
  })

  it('makes exactly one batched directory call for 25 notes (no N+1)', async () => {
    await seed(makeItem())
    for (let index = 0; index < 25; index += 1) {
      await seedNote(index, `user-${index % 5}`)
    }
    const actorDirectory = createCountingActorDirectory()

    const result = await getInboxNotes({
      noteRepo,
      repo,
      staffPublicApi: adminStaffApi,
      actorDirectory,
    })({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(result).toHaveLength(25)
    expect(actorDirectory.calls).toHaveLength(1)
    // Deduplicated: five distinct authors, not twenty-five lookups.
    expect(actorDirectory.calls[0]).toHaveLength(5)
  })
})
