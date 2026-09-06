import { describe, it, expect, vi } from 'vitest'
import { assignInboxItem } from './assign-inbox-item'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createSequentialInboxCommandStore } from '#/shared/testing/sequential-inbox-command-store'
import { isInboxError } from '../../domain/errors'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  feedbackId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-other')
const ITEM_ID = inboxItemId('ii-1')
const ASSIGNEE_ID = userId('user-2')
const USER_ID = userId('user-1')
const PROP_1 = propertyId('prop-1')
const PROP_OTHER = propertyId('prop-other')

const ctxFor = (role: Role, orgId = ORG_ID): AuthContext =>
  ({ organizationId: orgId, userId: USER_ID, role }) as AuthContext

const ctxWith = (...permissions: Permission[]): AuthContext => ({
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Staff',
  effectivePermissions: new Set(permissions),
  scopeByPermission: new Map(
    permissions.map((permission) => [permission, 'assigned-properties' as const]),
  ),
})

const seedItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROP_1,
  sourceType: 'review' as SourceType,
  sourceId: reviewId('rev-1'),
  status: 'new' as InboxStatus,
  rating: 4,
  sourceDate: new Date('2026-04-10'),
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

const setup = (staffApi: StaffPublicApi = defaultStaffApi) => {
  const repo = createInMemoryInboxRepo()
  const events = createRecordedOutbox()
  const commandStore = createSequentialInboxCommandStore({ repo, outbox: events })
  const deps = { repo, commandStore, clock: () => FIXED_TIME, staffPublicApi: staffApi }
  const execute = assignInboxItem(deps)
  type CommandInput = Parameters<typeof execute>[0]
  const useCase = (
    input: Omit<CommandInput, 'expectedCommandRevision'> &
      Partial<Pick<CommandInput, 'expectedCommandRevision'>>,
    ctx: AuthContext,
  ) =>
    execute(
      {
        ...input,
        expectedCommandRevision:
          input.expectedCommandRevision ??
          repo.items.find((item) => item.id === input.inboxItemId)?.commandRevision ??
          1,
      },
      ctx,
    )
  return { useCase, repo, events }
}

describe('assignInboxItem', () => {
  it('allows PropertyManager to assign an item', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem())

    const updated = await useCase(
      {
        inboxItemId: ITEM_ID,
        assignedToUserId: ASSIGNEE_ID,
      },
      ctxFor('PropertyManager'),
    )

    expect(updated.assignedTo).toBe(ASSIGNEE_ID)
    expect(updated.commandRevision).toBe(2)
  })

  it('allows AccountAdmin to assign an item', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem())

    const updated = await useCase(
      {
        inboxItemId: ITEM_ID,
        assignedToUserId: ASSIGNEE_ID,
      },
      ctxFor('AccountAdmin'),
    )

    expect(updated.assignedTo).toBe(ASSIGNEE_ID)
  })

  it('rejects Staff role with assignment_not_allowed', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem())

    await expect(
      useCase(
        {
          inboxItemId: ITEM_ID,
          assignedToUserId: ASSIGNEE_ID,
        },
        ctxFor('Staff'),
      ),
    ).rejects.toSatisfy(
      (e: unknown) => isInboxError(e) && e.code === 'assignment_not_allowed',
    )
  })

  it('allows an eligible user to claim an unassigned item without inbox.manage', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [PROP_1],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem())

    const updated = await useCase(
      { inboxItemId: ITEM_ID, assignedToUserId: USER_ID },
      ctxWith('inbox.write', 'review.read'),
    )

    expect(updated.assignedTo).toBe(USER_ID)
  })

  it('still requires inbox.manage when assigning another user', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem())

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, assignedToUserId: ASSIGNEE_ID },
        ctxWith('inbox.write', 'review.read'),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'assignment_not_allowed',
    )
  })

  it('requires feedback.handle to claim a private-feedback item', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [PROP_1],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(
      seedItem({ sourceType: 'feedback', sourceId: feedbackId('fb-private') }),
    )

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, assignedToUserId: USER_ID },
        ctxWith('inbox.write', 'feedback.read'),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
  })

  it('intersects feedback.handle scope for a self-service claim', async () => {
    const staffApi: StaffPublicApi = {
      ...defaultStaffApi,
      getAccessiblePropertyIds: async () => [PROP_OTHER],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(
      seedItem({ sourceType: 'feedback', sourceId: feedbackId('fb-private') }),
    )

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, assignedToUserId: USER_ID },
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
  })

  it('intersects inbox.manage scope when assigning another user', async () => {
    const staffApi: StaffPublicApi = {
      ...defaultStaffApi,
      getAccessiblePropertyIds: async (_orgId, candidateUserId) =>
        candidateUserId === ASSIGNEE_ID ? [PROP_1] : [PROP_OTHER],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem())

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, assignedToUserId: ASSIGNEE_ID },
        createScopedAuthContext({
          organizationId: ORG_ID,
          userId: USER_ID,
          permissions: [
            ['inbox.write', 'organization'],
            ['review.read', 'organization'],
            ['inbox.manage', 'assigned-properties'],
          ],
        }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
  })

  it('throws not_found for missing item', async () => {
    const { useCase } = setup()

    await expect(
      useCase(
        {
          inboxItemId: ITEM_ID,
          assignedToUserId: ASSIGNEE_ID,
        },
        ctxFor('PropertyManager'),
      ),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
  })

  it('records inbox.item.assigned when assigning to a user', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedItem())

    await useCase(
      {
        inboxItemId: ITEM_ID,
        assignedToUserId: ASSIGNEE_ID,
      },
      ctxFor('PropertyManager'),
    )

    const facts = events.facts
    expect(facts).toHaveLength(1)
    expect(facts[0]._tag).toBe('inbox.inbox_item.assigned')
  })

  it('records inbox.item.unassigned when assignedToUserId is null', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push({ ...seedItem(), assignedTo: ASSIGNEE_ID })

    await useCase(
      {
        inboxItemId: ITEM_ID,
        assignedToUserId: null,
      },
      ctxFor('PropertyManager'),
    )

    const facts = events.facts
    expect(facts).toHaveLength(1)
    expect(facts[0]._tag).toBe('inbox.inbox_item.unassigned')
  })

  it('scopes PropertyManager caller to assigned properties (PM is NOT org-wide for inbox)', async () => {
    // PM holds inbox.manage, but per root CONTEXT.md L72 PM only manages
    // ASSIGNED properties. The caller check (assertPropertyAccessible) must
    // enforce the staff_assignment scope for PM, not bypass it.
    const staffApi: StaffPublicApi = {
      // Caller (USER_ID) lacks PROP_1; assignee (ASSIGNEE_ID) has PROP_1 so
      // the INBOX-04 assignee check would pass — the CALLER check must reject.
      getAccessiblePropertyIds: async (_orgId, uId) =>
        uId === ASSIGNEE_ID ? [PROP_1] : [PROP_OTHER],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem())

    await expect(
      useCase(
        {
          inboxItemId: ITEM_ID,
          assignedToUserId: ASSIGNEE_ID,
        },
        ctxFor('PropertyManager'),
      ),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('denies access for role without inbox.write permission', async () => {
    // Roles without inbox.write hit the auth gate before validateAssignment
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem())

    await expect(
      useCase(
        {
          inboxItemId: ITEM_ID,
          assignedToUserId: ASSIGNEE_ID,
        },
        ctxFor('Guest' as unknown as Role),
      ),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('allows assignment when user has access to the property', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [PROP_1],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem())

    const updated = await useCase(
      {
        inboxItemId: ITEM_ID,
        assignedToUserId: ASSIGNEE_ID,
      },
      ctxFor('PropertyManager'),
    )

    expect(updated.assignedTo).toBe(ASSIGNEE_ID)
  })

  // ── INBOX-04: Assignee property access ──────────────────────────
  it('defers assignee eligibility to the transaction-bound command authority', async () => {
    // The application preflight checks only the actor. Assignment itself grants
    // no authority; the production command store rechecks this target inside
    // the write transaction. The sequential fake deliberately allows it.
    const getAccessiblePropertyIds = vi.fn(async (_orgId, uId) =>
      uId === USER_ID ? [PROP_1] : [PROP_OTHER],
    )
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds,
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem())

    await expect(
      useCase(
        {
          inboxItemId: ITEM_ID,
          assignedToUserId: ASSIGNEE_ID,
        },
        ctxFor('PropertyManager'),
      ),
    ).resolves.toMatchObject({ assignedTo: ASSIGNEE_ID })
    expect(getAccessiblePropertyIds).toHaveBeenCalledWith(ORG_ID, USER_ID, false)
    expect(getAccessiblePropertyIds).not.toHaveBeenCalledWith(
      ORG_ID,
      ASSIGNEE_ID,
      expect.anything(),
    )
  })

  // ── Tenant isolation ──────────────────────────────────────────────
  it('throws not_found when item belongs to a different organization', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem()) // ORG_ID item

    await expect(
      useCase(
        {
          inboxItemId: ITEM_ID,
          assignedToUserId: ASSIGNEE_ID,
        },
        ctxFor('PropertyManager', OTHER_ORG_ID),
      ),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
  })
})
