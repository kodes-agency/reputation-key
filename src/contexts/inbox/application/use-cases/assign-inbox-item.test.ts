import { describe, it, expect } from 'vitest'
import { assignInboxItem } from './assign-inbox-item'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createSequentialInboxCommandStore } from '#/shared/testing/sequential-inbox-command-store'
import { isInboxError } from '../../domain/errors'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'

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

const seedItem = (): InboxItem => ({
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
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
})

const defaultStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
}

const setup = (staffApi: StaffPublicApi = defaultStaffApi) => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const commandStore = createSequentialInboxCommandStore({ repo, events })
  const deps = { repo, commandStore, clock: () => FIXED_TIME, staffPublicApi: staffApi }
  const useCase = assignInboxItem(deps)
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

  it('emits inbox.item.assigned event when assigning to a user', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedItem())

    await useCase(
      {
        inboxItemId: ITEM_ID,
        assignedToUserId: ASSIGNEE_ID,
      },
      ctxFor('PropertyManager'),
    )

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('inbox.inbox_item.assigned')
  })

  it('emits inbox.item.unassigned event when unassigning (assignedToUserId is null)', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push({ ...seedItem(), assignedTo: ASSIGNEE_ID })

    await useCase(
      {
        inboxItemId: ITEM_ID,
        assignedToUserId: null,
      },
      ctxFor('PropertyManager'),
    )

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('inbox.inbox_item.unassigned')
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
      countAssignmentsByTeam: async () => 0,
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
      countAssignmentsByTeam: async () => 0,
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
      countAssignmentsByTeam: async () => 0,
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
  it('rejects assignment when assignee lacks access to the property', async () => {
    // Caller (PropertyManager) is assigned to PROP_1 so the caller check passes;
    // assignee (ASSIGNEE_ID) is NOT assigned to PROP_1 — INBOX-04 rejects.
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async (_orgId, uId) =>
        uId === USER_ID ? [PROP_1] : [PROP_OTHER],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
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
