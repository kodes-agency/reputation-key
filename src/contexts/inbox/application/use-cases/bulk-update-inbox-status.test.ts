import { describe, it, expect, vi } from 'vitest'
import {
  bulkUpdateInboxStatus,
  type BulkUpdateInboxStatusInput,
} from './bulk-update-inbox-status'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { createSequentialInboxCommandStore } from '#/shared/testing/sequential-inbox-command-store'
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
import type { Permission } from '#/shared/domain/permissions'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import { isInboxError } from '../../domain/errors'
import type { ReviewSourceLookupPort } from '../ports/review-source-lookup.port'
import type { ReviewResponseTargetAuthorityPort } from '../ports/review-response-target-authority.port'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const PROVIDER_TIME = new Date('2026-04-10T12:00:00Z')
const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-other')
const USER_ID = userId('user-1')

const ctxFor = (role: Role, orgId = ORG_ID): AuthContext =>
  ({ organizationId: orgId, userId: USER_ID, role }) as AuthContext

const ctxWith = (...permissions: Permission[]): AuthContext => ({
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Staff',
  effectivePermissions: new Set(permissions),
  scopeByPermission: new Map(
    permissions.map((permission) => [permission, 'organization' as const]),
  ),
})

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
    commandRevision: 1,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  }
}

const defaultStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const setup = (staffApi: StaffPublicApi = defaultStaffApi) => {
  const repo = createInMemoryInboxRepo()
  const events = createRecordedOutbox()
  const commandStore = createSequentialInboxCommandStore({ repo, outbox: events })
  const reviewSourceLookup: ReviewSourceLookupPort = {
    getReviewSourceMetaById: async () => null,
    getReviewSourceMetaByIds: async (ids) =>
      ids.flatMap((id) => {
        const item = repo.items.find(
          (candidate) => candidate.sourceType === 'review' && candidate.sourceId === id,
        )
        return item
          ? [
              {
                id,
                propertyId: item.propertyId,
                platform: 'google',
                sourceEpoch: 1,
                sourceDate: item.sourceDate,
                contentExpiresAt: null,
                materialReviewRevision: 1,
              },
            ]
          : []
      }),
    listReviewSources: async () => [],
  }
  const responseTargetAuthority: ReviewResponseTargetAuthorityPort = {
    withExactCurrent: async () => ({ status: 'obsolete' }),
    withInboxProjection: async () => ({ status: 'obsolete' }),
    withExactCurrentBatch: async (expectations, apply) => ({
      status: 'current',
      value: await apply(
        expectations.map((expectation) => ({
          ...expectation,
          authority: 'review.current-response-target.v1',
          materialReviewRevision: 1,
          eligibility: 'measured',
          responseTargetStartAt: PROVIDER_TIME,
        })),
      ),
    }),
  }
  const deps = {
    repo,
    commandStore,
    clock: () => FIXED_TIME,
    idGen: () => '6a000000-0000-4000-8000-000000000002',
    staffPublicApi: staffApi,
    reviewSourceLookup,
    responseTargetAuthority,
    logger: createMockLogger(),
  }
  const execute = bulkUpdateInboxStatus(deps)
  const useCase = (
    input: Omit<BulkUpdateInboxStatusInput, 'reopenReason'> &
      Partial<Pick<BulkUpdateInboxStatusInput, 'reopenReason'>>,
    ctx: AuthContext,
  ) => execute({ reopenReason: 'new_information', ...input }, ctx)
  return { useCase, repo, events, commandStore }
}

const expectItemStatuses = (
  repo: { items: ReadonlyArray<{ status: InboxStatus }> },
  ...statuses: InboxStatus[]
): void => {
  statuses.forEach((status, i) => expect(repo.items[i]?.status).toBe(status))
}

const bulkCommands = (...ids: string[]) =>
  ids.map((id) => ({
    inboxItemId: inboxItemId(id),
    expectedCommandRevision: 1,
  }))

describe('bulkUpdateInboxStatus', () => {
  it('updates multiple items with valid transitions', async () => {
    const { useCase, repo, commandStore } = setup()
    const storeCall = vi.spyOn(commandStore, 'bulkUpdateStatus')
    repo.items.push(seedItem('ii-1', 'closed'))
    repo.items.push(seedItem('ii-2', 'closed'))

    const result = await useCase(
      {
        items: bulkCommands('ii-1', 'ii-2'),
        newStatus: 'open',
      },
      ctxFor('AccountAdmin'),
    )

    expect(result.updated).toBe(2)
    expect(result.results).toEqual([
      { inboxItemId: inboxItemId('ii-1'), outcome: 'reopened' },
      { inboxItemId: inboxItemId('ii-2'), outcome: 'reopened' },
    ])
    expect(repo.items[0].status).toBe('open')
    expect(repo.items[1].status).toBe('open')
    const targets = storeCall.mock.calls[0]?.[3]
    expect(targets).toBeInstanceOf(Map)
    expect([...(targets?.values() ?? [])]).toEqual([
      expect.objectContaining({
        reviewAuthority: expect.objectContaining({
          eligibility: 'measured',
          responseTargetStartAt: PROVIDER_TIME,
        }),
        targetStart: { basis: 'operational_reopen', at: FIXED_TIME },
      }),
      expect.objectContaining({
        reviewAuthority: expect.objectContaining({
          eligibility: 'measured',
          responseTargetStartAt: PROVIDER_TIME,
        }),
        targetStart: { basis: 'operational_reopen', at: FIXED_TIME },
      }),
    ])
  })

  it('forwards the governed reason and Other explanation to the store', async () => {
    const { useCase, repo, commandStore } = setup()
    repo.items.push(seedItem('ii-1', 'closed', 'prop-1', 'feedback'))
    const storeCall = vi.spyOn(commandStore, 'bulkUpdateStatus')

    await useCase(
      {
        items: bulkCommands('ii-1'),
        newStatus: 'open',
        reopenReason: 'other',
        reopenExplanation: '  A new guest message needs follow-up.  ',
      },
      ctxFor('AccountAdmin'),
    )

    expect(storeCall).toHaveBeenCalledWith(
      [expect.objectContaining({ id: inboxItemId('ii-1') })],
      [expect.objectContaining({ newStatus: 'open' })],
      {
        reason: 'other',
        explanation: '  A new guest message needs follow-up.  ',
      },
    )
  })

  it('skips items with invalid transitions', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-1', 'closed'))
    repo.items.push(seedItem('ii-2', 'open'))

    const result = await useCase(
      {
        items: bulkCommands('ii-1', 'ii-2'),
        newStatus: 'open',
      },
      ctxFor('AccountAdmin'),
    )

    // ii-1: closed→open (valid), ii-2: open→open (invalid — same status)
    expect(result.updated).toBe(1)
    expect(result.results).toEqual([
      { inboxItemId: inboxItemId('ii-1'), outcome: 'reopened' },
      { inboxItemId: inboxItemId('ii-2'), outcome: 'already_open' },
    ])
    expectItemStatuses(repo, 'open', 'open')
  })

  it('returns 0 when all transitions are invalid', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-1', 'open'))

    const result = await useCase(
      {
        items: bulkCommands('ii-1'),
        newStatus: 'open', // open → open is invalid
      },
      ctxFor('AccountAdmin'),
    )

    expect(result.updated).toBe(0)
    expect(result.results).toEqual([
      { inboxItemId: inboxItemId('ii-1'), outcome: 'already_open' },
    ])
  })

  it('reports a stale client revision without mutating or recording a fact', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedItem('ii-1', 'closed'))

    const result = await useCase(
      {
        items: [
          {
            inboxItemId: inboxItemId('ii-1'),
            expectedCommandRevision: 2,
          },
        ],
        newStatus: 'open',
      },
      ctxFor('AccountAdmin'),
    )

    expect(result).toEqual({
      updated: 0,
      results: [{ inboxItemId: inboxItemId('ii-1'), outcome: 'revision_conflict' }],
    })
    expect(repo.items[0]!.status).toBe('closed')
    expect(events.byTag('inbox.inbox_item.bulk_status_changed')).toEqual([])
  })

  it('rejects duplicate command IDs at the application boundary', async () => {
    const { useCase } = setup()
    const duplicate = bulkCommands('ii-1', 'ii-1')

    await expect(
      useCase({ items: duplicate, newStatus: 'open' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
  })

  it('records one bulk status fact per updated item with a shared bulkId', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedItem('ii-1', 'closed'))
    repo.items.push(seedItem('ii-2', 'closed'))

    await useCase(
      {
        items: bulkCommands('ii-1', 'ii-2'),
        newStatus: 'open',
      },
      ctxFor('AccountAdmin'),
    )

    const facts = events.byTag('inbox.inbox_item.bulk_status_changed')
    expect(facts).toHaveLength(2)
    const bulkIds = facts.map((fact) => fact.bulkId)
    expect(bulkIds[0]).toBeTruthy()
    expect(new Set(bulkIds).size).toBe(1)
  })

  it('reopens both review and feedback items without a source-type guard', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-1', 'closed', 'prop-1', 'review'))
    repo.items.push(seedItem('ii-2', 'closed', 'prop-1', 'feedback'))

    const result = await useCase(
      {
        items: bulkCommands('ii-1', 'ii-2'),
        newStatus: 'open',
      },
      ctxFor('AccountAdmin'),
    )

    expect(result.updated).toBe(2)
    expect(repo.items[0].status).toBe('open')
    expect(repo.items[1].status).toBe('open')
  })

  it('updates only source families the caller is allowed to handle', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-review', 'closed', 'prop-1', 'review'))
    repo.items.push(seedItem('ii-feedback', 'closed', 'prop-1', 'feedback'))

    const result = await useCase(
      {
        items: bulkCommands('ii-review', 'ii-feedback'),
        newStatus: 'open',
      },
      ctxWith('inbox.write', 'review.read'),
    )

    expect(result.updated).toBe(1)
    expect(result.results).toEqual([
      { inboxItemId: inboxItemId('ii-review'), outcome: 'reopened' },
      { inboxItemId: inboxItemId('ii-feedback'), outcome: 'unavailable' },
    ])
    expectItemStatuses(repo, 'open', 'closed')
  })

  it('does not treat feedback.read as permission to handle private feedback', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-feedback', 'closed', 'prop-1', 'feedback'))

    const result = await useCase(
      {
        items: bulkCommands('ii-feedback'),
        newStatus: 'open',
      },
      ctxWith('inbox.write', 'feedback.read'),
    )

    expect(result.updated).toBe(0)
    expect(result.results).toEqual([
      { inboxItemId: inboxItemId('ii-feedback'), outcome: 'unavailable' },
    ])
    expect(repo.items[0]!.status).toBe('closed')
  })

  it('intersects each source handling scope across a mixed batch', async () => {
    const staffApi: StaffPublicApi = {
      ...defaultStaffApi,
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(
      seedItem('review-2', 'closed', 'prop-2', 'review'),
      seedItem('feedback-1', 'closed', 'prop-1', 'feedback'),
      seedItem('feedback-2', 'closed', 'prop-2', 'feedback'),
    )

    const result = await useCase(
      {
        items: bulkCommands('review-2', 'feedback-1', 'feedback-2'),
        newStatus: 'open',
      },
      createScopedAuthContext({
        organizationId: ORG_ID,
        userId: USER_ID,
        permissions: [
          ['inbox.write', 'organization'],
          ['review.read', 'organization'],
          ['feedback.handle', 'assigned-properties'],
        ],
      }),
    )

    expect(result.updated).toBe(2)
    expectItemStatuses(repo, 'open', 'open', 'closed')
  })

  it('denies access to all items when Staff has no property assignments', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem('ii-1', 'closed', 'prop-1'))
    repo.items.push(seedItem('ii-2', 'closed', 'prop-2'))

    const result = await useCase(
      {
        items: bulkCommands('ii-1', 'ii-2'),
        newStatus: 'open',
      },
      ctxFor('Staff'),
    )

    expect(result.updated).toBe(0)
    expect(result.results).toEqual([
      { inboxItemId: inboxItemId('ii-1'), outcome: 'unavailable' },
      { inboxItemId: inboxItemId('ii-2'), outcome: 'unavailable' },
    ])
    expect(repo.items[0].status).toBe('closed')
    expect(repo.items[1].status).toBe('closed')
  })

  it('filters out items from inaccessible properties for Staff', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem('ii-1', 'closed', 'prop-1'))
    repo.items.push(seedItem('ii-2', 'closed', 'prop-2'))

    const result = await useCase(
      {
        items: bulkCommands('ii-1', 'ii-2'),
        newStatus: 'open',
      },
      ctxFor('Staff'),
    )

    expect(result.updated).toBe(1)
    expectItemStatuses(repo, 'open', 'closed')
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem('ii-1', 'closed', 'prop-1'))
    repo.items.push(seedItem('ii-2', 'closed', 'prop-2'))

    const result = await useCase(
      {
        items: bulkCommands('ii-1', 'ii-2'),
        newStatus: 'open',
      },
      ctxFor('PropertyManager'),
    )

    expect(result.updated).toBe(1)
    expectItemStatuses(repo, 'open', 'closed')
  })

  it('skips all items for PropertyManager with no property assignments', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem('ii-1', 'closed', 'prop-1'))

    const result = await useCase(
      {
        items: bulkCommands('ii-1'),
        newStatus: 'open',
      },
      ctxFor('PropertyManager'),
    )

    expect(result.updated).toBe(0)
    expect(repo.items[0].status).toBe('closed')
  })

  it('processes all items for AccountAdmin', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => {
        throw new Error('Should not be called for AccountAdmin')
      },
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem('ii-1', 'closed', 'prop-1'))
    repo.items.push(seedItem('ii-2', 'closed', 'prop-2'))

    const result = await useCase(
      {
        items: bulkCommands('ii-1', 'ii-2'),
        newStatus: 'open',
      },
      ctxFor('AccountAdmin'),
    )

    expect(result.updated).toBe(2)
    expect(repo.items[0].status).toBe('open')
    expect(repo.items[1].status).toBe('open')
  })

  // ── Tenant isolation ──────────────────────────────────────────────
  it('does not update items belonging to a different organization', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-1', 'closed'))
    repo.items.push(seedItem('ii-2', 'closed'))

    const result = await useCase(
      {
        items: bulkCommands('ii-1', 'ii-2'),
        newStatus: 'open',
      },
      ctxFor('AccountAdmin', OTHER_ORG_ID),
    )

    // Items belong to ORG_ID; caller is in OTHER_ORG_ID — zero updates, items unchanged
    expect(result.updated).toBe(0)
    expect(result.results).toEqual([
      { inboxItemId: inboxItemId('ii-1'), outcome: 'unavailable' },
      { inboxItemId: inboxItemId('ii-2'), outcome: 'unavailable' },
    ])
    expect(repo.items[0].status).toBe('closed')
    expect(repo.items[1].status).toBe('closed')
  })
})
