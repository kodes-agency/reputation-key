import { describe, it, expect, vi } from 'vitest'
import { updateInboxStatus } from './update-inbox-status'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
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
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import type { ReviewHandlingCycleStore } from '../ports/review-handling-cycle.store'
import type { ReviewSourceLookupPort } from '../ports/review-source-lookup.port'
import type { ReviewResponseTargetAuthorityPort } from '../ports/review-response-target-authority.port'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const PROVIDER_TIME = new Date('2026-04-10T12:00:00Z')
const ORG_ID = organizationId('org-1')
const ITEM_ID = inboxItemId('ii-1')
const USER_ID = userId('user-1')

const ctxFor = (role: Role): AuthContext =>
  ({ organizationId: ORG_ID, userId: USER_ID, role }) as AuthContext

const ctxWith = (...permissions: Permission[]): AuthContext => ({
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Staff',
  effectivePermissions: new Set(permissions),
  scopeByPermission: new Map(
    permissions.map((permission) => [permission, 'organization' as const]),
  ),
})

function seedOpen(overrides?: Partial<InboxItem>): InboxItem {
  return {
    id: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: propertyId('prop-1'),
    sourceType: 'feedback' as SourceType,
    sourceId: feedbackId('fb-1'),
    status: 'open' as InboxStatus,
    rating: 4,
    sourceDate: new Date('2026-04-10'),
    platform: null,
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
  }
}

const staffApiAllAccess: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const setup = (staffApi: StaffPublicApi = staffApiAllAccess) => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const commandStore = createSequentialInboxCommandStore({ repo, events })
  const cycleStore: ReviewHandlingCycleStore = {
    findSourceHead: async (itemId, organizationIdValue) => {
      const item = repo.items.find(
        (candidate) =>
          candidate.id === itemId && candidate.organizationId === organizationIdValue,
      )
      return item
        ? {
            inboxItemId: item.id,
            organizationId: item.organizationId,
            propertyId: item.propertyId,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            currentCycleNumber: 1,
            currentSourceRevision: 1,
            stateRevision: 1,
            status: item.status,
          }
        : null
    },
    findHead: async (itemId, organizationIdValue) => {
      const item = repo.items.find(
        (candidate) =>
          candidate.id === itemId &&
          candidate.organizationId === organizationIdValue &&
          candidate.sourceType === 'review',
      )
      return item
        ? {
            inboxItemId: item.id,
            organizationId: item.organizationId,
            propertyId: item.propertyId,
            reviewId: reviewId(item.sourceId),
            currentCycleNumber: 1,
            currentMaterialReviewRevision: 1,
            stateRevision: 1,
            status: item.status,
          }
        : null
    },
    listCycles: async () => [],
    startNext: async () => {
      throw new Error('not used by status commands')
    },
  }
  const reviewSourceLookup: ReviewSourceLookupPort = {
    getReviewSourceMetaById: async (id) => ({
      id,
      propertyId: propertyId('prop-1'),
      platform: 'google',
      sourceEpoch: 1,
      sourceDate: FIXED_TIME,
      contentExpiresAt: null,
      materialReviewRevision: 1,
    }),
    getReviewSourceMetaByIds: async () => [],
    listReviewSources: async () => [],
  }
  const responseTargetAuthority: ReviewResponseTargetAuthorityPort = {
    withExactCurrent: async (expectation, apply) => ({
      status: 'current',
      value: await apply({
        ...expectation,
        authority: 'review.current-response-target.v1',
        materialReviewRevision: 1,
        eligibility: 'measured',
        responseTargetStartAt: PROVIDER_TIME,
      }),
    }),
    withInboxProjection: async () => ({ status: 'obsolete' }),
    withExactCurrentBatch: async () => ({ status: 'obsolete' }),
  }
  const deps = {
    repo,
    commandStore,
    clock: () => FIXED_TIME,
    staffPublicApi: staffApi,
    cycleStore,
    reviewSourceLookup,
    responseTargetAuthority,
  }
  const execute = updateInboxStatus(deps)
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
  return { useCase, repo, events, commandStore }
}

describe('updateInboxStatus', () => {
  it('routes private-feedback close through the outcome-specific command', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedOpen())

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'closed' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
    expect(repo.items[0]).toMatchObject({ status: 'open', commandRevision: 1 })
  })

  it('transitions closed → open (reopen)', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedOpen({ status: 'closed' }))

    const updated = await useCase(
      {
        inboxItemId: ITEM_ID,
        newStatus: 'open',
        reopenReason: 'internal_follow_up_still_needed',
      },
      ctxFor('AccountAdmin'),
    )

    expect(updated.status).toBe('open')
  })

  it('throws invalid_transition for same-status transition', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedOpen({ status: 'open' }))

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'open' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy(
      (e: unknown) => isInboxError(e) && e.code === 'invalid_transition',
    )
  })

  it('throws not_found for missing item', async () => {
    const { useCase } = setup()

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'closed' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
  })

  it('emits inbox.status.changed event when governed reopen succeeds', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedOpen({ status: 'closed', closedAt: FIXED_TIME }))

    await useCase(
      {
        inboxItemId: ITEM_ID,
        newStatus: 'open',
        reopenReason: 'new_information',
      },
      ctxFor('AccountAdmin'),
    )

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('inbox.inbox_item.status_changed')
  })

  it('rejects manual close on a Review because Google observation owns closure', async () => {
    const { useCase, repo } = setup()
    repo.items.push(
      seedOpen({ sourceType: 'review' as SourceType, sourceId: reviewId('rev-1') }),
    )

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'closed' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
    expect(repo.items[0]?.status).toBe('open')
  })

  it('reopens a closed Review only with a governed neutral reason', async () => {
    const { useCase, repo, commandStore } = setup()
    const reopen = vi.spyOn(commandStore, 'reopenReviewCycle')
    repo.items.push(
      seedOpen({
        sourceType: 'review',
        sourceId: reviewId('rev-1'),
        status: 'closed',
        closedAt: FIXED_TIME,
      }),
    )

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'open' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )

    await expect(
      useCase(
        {
          inboxItemId: ITEM_ID,
          newStatus: 'open',
          reopenReason: 'new_information',
        },
        ctxFor('AccountAdmin'),
      ),
    ).resolves.toMatchObject({ status: 'open', closedAt: null })
    expect(reopen).toHaveBeenCalledWith(
      expect.objectContaining({
        responseTarget: expect.objectContaining({
          reviewAuthority: expect.objectContaining({
            eligibility: 'measured',
            responseTargetStartAt: PROVIDER_TIME,
          }),
          targetStart: { basis: 'operational_reopen', at: FIXED_TIME },
        }),
      }),
    )
  })

  it('rejects generic manual close on a feedback item', async () => {
    const { useCase, repo } = setup()
    repo.items.push(
      seedOpen({ sourceType: 'feedback' as SourceType, sourceId: feedbackId('fb-1') }),
    )

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'closed' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
  })

  it('requires feedback.handle to change private-feedback workflow status', async () => {
    const { useCase, repo } = setup()
    repo.items.push(
      seedOpen({ sourceType: 'feedback', sourceId: feedbackId('fb-private') }),
    )

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, newStatus: 'closed' },
        ctxWith('inbox.write', 'feedback.read'),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
    expect(repo.items[0]!.status).toBe('open')
  })

  it('still requires the outcome-specific command with feedback.handle', async () => {
    const { useCase, repo } = setup()
    repo.items.push(
      seedOpen({ sourceType: 'feedback', sourceId: feedbackId('fb-private') }),
    )

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, newStatus: 'closed' },
        ctxWith('inbox.write', 'feedback.handle'),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
  })

  it('intersects feedback.handle scope before changing workflow status', async () => {
    const staffApi: StaffPublicApi = {
      ...staffApiAllAccess,
      getAccessiblePropertyIds: async () => [propertyId('prop-other')],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(
      seedOpen({ sourceType: 'feedback', sourceId: feedbackId('fb-private') }),
    )

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, newStatus: 'closed' },
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
    expect(repo.items[0]!.status).toBe('open')
  })

  it('denies access without inbox.write permission for inaccessible property', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedOpen())

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, newStatus: 'closed' },
        ctxFor('Guest' as unknown as Role),
      ),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('allows update when user has access to the property', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedOpen({ status: 'closed', closedAt: FIXED_TIME }))

    await expect(
      useCase(
        {
          inboxItemId: ITEM_ID,
          newStatus: 'open',
          reopenReason: 'new_information',
        },
        ctxFor('PropertyManager'),
      ),
    ).resolves.toBeDefined()
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-assigned')],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedOpen({ propertyId: propertyId('prop-other') }))

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'closed' }, ctxFor('PropertyManager')),
    ).rejects.toMatchObject({ _tag: 'InboxError', code: 'forbidden' })

    expect(repo.items[0]!.status).toBe('open')
  })

  it('allows PropertyManager to update status for an assigned property', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedOpen({ status: 'closed', closedAt: FIXED_TIME }))

    const updated = await useCase(
      {
        inboxItemId: ITEM_ID,
        newStatus: 'open',
        reopenReason: 'new_information',
      },
      ctxFor('PropertyManager'),
    )

    expect(updated.status).toBe('open')
  })

  it('skips property check for AccountAdmin role', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => {
        throw new Error('Should not be called')
      },
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedOpen({ status: 'closed', closedAt: FIXED_TIME }))

    await expect(
      useCase(
        {
          inboxItemId: ITEM_ID,
          newStatus: 'open',
          reopenReason: 'new_information',
        },
        ctxFor('AccountAdmin'),
      ),
    ).resolves.toBeDefined()
  })
})
