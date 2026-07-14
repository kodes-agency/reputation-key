import { describe, it, expect } from 'vitest'
import { bulkUpdateInboxStatus } from './bulk-update-inbox-status'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  feedbackId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'
import type { AuthContext } from '#/shared/domain/auth-context'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-other')
const USER_ID = userId('user-1')

const ctxFor = (role: Role, orgId = ORG_ID): AuthContext =>
  ({ organizationId: orgId, userId: USER_ID, role }) as AuthContext

function seedItem(
  id: string,
  status: InboxStatus,
  propId: string = 'prop-1',
  sourceType: SourceType = 'review',
): InboxItem {
  return {
    id: inboxItemId(id),
    organizationId: ORG_ID,
    propertyId: propertyId(propId),
    sourceType,
    sourceId: sourceType === 'review' ? reviewId(`rev-${id}`) : feedbackId(`fb-${id}`),
    status,
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
  }
}

const defaultStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
}

const setup = (staffApi: StaffPublicApi = defaultStaffApi) => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const deps = {
    repo,
    events,
    clock: () => FIXED_TIME,
    staffPublicApi: staffApi,
    logger: createMockLogger(),
  }
  const useCase = bulkUpdateInboxStatus(deps)
  return { useCase, repo, events }
}

const expectItemStatuses = (
  repo: { items: ReadonlyArray<{ status: InboxStatus }> },
  ...statuses: InboxStatus[]
): void => {
  statuses.forEach((status, i) => expect(repo.items[i]?.status).toBe(status))
}

describe('bulkUpdateInboxStatus', () => {
  it('updates multiple items with valid transitions', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-1', 'open'))
    repo.items.push(seedItem('ii-2', 'open'))

    const result = await useCase(
      {
        inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
        newStatus: 'closed',
      },
      ctxFor('AccountAdmin'),
    )

    expect(result.updated).toBe(2)
    expect(repo.items[0].status).toBe('closed')
    expect(repo.items[1].status).toBe('closed')
  })

  it('skips items with invalid transitions', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-1', 'open'))
    repo.items.push(seedItem('ii-2', 'closed'))

    const result = await useCase(
      {
        inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
        newStatus: 'closed',
      },
      ctxFor('AccountAdmin'),
    )

    // ii-1: open→closed (valid), ii-2: closed→closed (invalid — same status)
    expect(result.updated).toBe(1)
    expectItemStatuses(repo, 'closed', 'closed')
  })

  it('returns 0 when all transitions are invalid', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-1', 'closed'))

    const result = await useCase(
      {
        inboxItemIds: [inboxItemId('ii-1')],
        newStatus: 'closed', // closed → closed is invalid
      },
      ctxFor('AccountAdmin'),
    )

    expect(result.updated).toBe(0)
  })

  it('emits bulk status changed events for each updated item with shared bulkId', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedItem('ii-1', 'open'))
    repo.items.push(seedItem('ii-2', 'open'))

    await useCase(
      {
        inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
        newStatus: 'closed',
      },
      ctxFor('AccountAdmin'),
    )

    const emitted = events.capturedByTag('inbox.inbox_item.bulk_status_changed')
    expect(emitted).toHaveLength(2)
    const bulkIds = emitted.map((e) => e.bulkId)
    expect(bulkIds[0]).toBeTruthy()
    expect(new Set(bulkIds).size).toBe(1) // all events share the same bulkId
  })

  it('closes both review and feedback items (no source-type guard — ADR 0023)', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-1', 'open', 'prop-1', 'review'))
    repo.items.push(seedItem('ii-2', 'open', 'prop-1', 'feedback'))

    const result = await useCase(
      {
        inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
        newStatus: 'closed',
      },
      ctxFor('AccountAdmin'),
    )

    expect(result.updated).toBe(2)
    expect(repo.items[0].status).toBe('closed')
    expect(repo.items[1].status).toBe('closed')
  })

  it('denies access to all items when Staff has no property assignments', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem('ii-1', 'open', 'prop-1'))
    repo.items.push(seedItem('ii-2', 'open', 'prop-2'))

    const result = await useCase(
      {
        inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
        newStatus: 'closed',
      },
      ctxFor('Staff'),
    )

    expect(result.updated).toBe(0)
    expect(repo.items[0].status).toBe('open')
    expect(repo.items[1].status).toBe('open')
  })

  it('filters out items from inaccessible properties for Staff', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem('ii-1', 'open', 'prop-1'))
    repo.items.push(seedItem('ii-2', 'open', 'prop-2'))

    const result = await useCase(
      {
        inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
        newStatus: 'closed',
      },
      ctxFor('Staff'),
    )

    expect(result.updated).toBe(1)
    expectItemStatuses(repo, 'closed', 'open')
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem('ii-1', 'open', 'prop-1'))
    repo.items.push(seedItem('ii-2', 'open', 'prop-2'))

    const result = await useCase(
      {
        inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
        newStatus: 'closed',
      },
      ctxFor('PropertyManager'),
    )

    expect(result.updated).toBe(1)
    expectItemStatuses(repo, 'closed', 'open')
  })

  it('skips all items for PropertyManager with no property assignments', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem('ii-1', 'open', 'prop-1'))

    const result = await useCase(
      {
        inboxItemIds: [inboxItemId('ii-1')],
        newStatus: 'closed',
      },
      ctxFor('PropertyManager'),
    )

    expect(result.updated).toBe(0)
    expect(repo.items[0].status).toBe('open')
  })

  it('processes all items for AccountAdmin', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => {
        throw new Error('Should not be called for AccountAdmin')
      },
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem('ii-1', 'open', 'prop-1'))
    repo.items.push(seedItem('ii-2', 'open', 'prop-2'))

    const result = await useCase(
      {
        inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
        newStatus: 'closed',
      },
      ctxFor('AccountAdmin'),
    )

    expect(result.updated).toBe(2)
    expect(repo.items[0].status).toBe('closed')
    expect(repo.items[1].status).toBe('closed')
  })

  // ── Tenant isolation ──────────────────────────────────────────────
  it('does not update items belonging to a different organization', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-1', 'open'))
    repo.items.push(seedItem('ii-2', 'open'))

    const result = await useCase(
      {
        inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
        newStatus: 'closed',
      },
      ctxFor('AccountAdmin', OTHER_ORG_ID),
    )

    // Items belong to ORG_ID; caller is in OTHER_ORG_ID — zero updates, items unchanged
    expect(result.updated).toBe(0)
    expect(repo.items[0].status).toBe('open')
    expect(repo.items[1].status).toBe('open')
  })
})
