import { describe, it, expect } from 'vitest'
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

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const ITEM_ID = inboxItemId('ii-1')
const USER_ID = userId('user-1')

const ctxFor = (role: Role): AuthContext =>
  ({ organizationId: ORG_ID, userId: USER_ID, role }) as AuthContext

function seedOpen(overrides?: Partial<InboxItem>): InboxItem {
  return {
    id: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: propertyId('prop-1'),
    sourceType: 'review' as SourceType,
    sourceId: reviewId('rev-1'),
    status: 'open' as InboxStatus,
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
    ...overrides,
  }
}

const staffApiAllAccess: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
}

const setup = (staffApi: StaffPublicApi = staffApiAllAccess) => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const commandStore = createSequentialInboxCommandStore({ repo, events })
  const deps = {
    repo,
    commandStore,
    clock: () => FIXED_TIME,
    staffPublicApi: staffApi,
  }
  const useCase = updateInboxStatus(deps)
  return { useCase, repo, events }
}

describe('updateInboxStatus', () => {
  it('transitions open → closed successfully', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedOpen())

    const updated = await useCase(
      { inboxItemId: ITEM_ID, newStatus: 'closed' },
      ctxFor('AccountAdmin'),
    )

    expect(updated.status).toBe('closed')
    expect(updated.closedAt).toBe(FIXED_TIME)
  })

  it('transitions closed → open (reopen)', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedOpen({ status: 'closed' }))

    const updated = await useCase(
      { inboxItemId: ITEM_ID, newStatus: 'open' },
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

  it('emits inbox.status.changed event', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedOpen())

    await useCase({ inboxItemId: ITEM_ID, newStatus: 'closed' }, ctxFor('AccountAdmin'))

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('inbox.inbox_item.status_changed')
  })

  it('allows manual close on a review item (no source-type guard — ADR 0023)', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedOpen({ sourceType: 'review' as SourceType }))

    const updated = await useCase(
      { inboxItemId: ITEM_ID, newStatus: 'closed' },
      ctxFor('AccountAdmin'),
    )

    expect(updated.status).toBe('closed')
  })

  it('allows manual close on a feedback item', async () => {
    const { useCase, repo } = setup()
    repo.items.push(
      seedOpen({ sourceType: 'feedback' as SourceType, sourceId: feedbackId('fb-1') }),
    )

    const updated = await useCase(
      { inboxItemId: ITEM_ID, newStatus: 'closed' },
      ctxFor('AccountAdmin'),
    )

    expect(updated.status).toBe('closed')
  })

  it('denies access without inbox.write permission for inaccessible property', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
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
      countAssignmentsByTeam: async () => 0,
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedOpen())

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'closed' }, ctxFor('PropertyManager')),
    ).resolves.toBeDefined()
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-assigned')],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
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
      countAssignmentsByTeam: async () => 0,
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedOpen())

    const updated = await useCase(
      { inboxItemId: ITEM_ID, newStatus: 'closed' },
      ctxFor('PropertyManager'),
    )

    expect(updated.status).toBe('closed')
  })

  it('skips property check for AccountAdmin role', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => {
        throw new Error('Should not be called')
      },
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedOpen())

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'closed' }, ctxFor('AccountAdmin')),
    ).resolves.toBeDefined()
  })
})
