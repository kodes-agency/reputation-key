import { describe, it, expect } from 'vitest'
import { resolveEscalation } from './resolve-escalation'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { isInboxError } from '../../domain/errors'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'
import type { AuthContext } from '#/shared/domain/auth-context'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const ITEM_ID = inboxItemId('ii-1')
const USER_ID = userId('user-1')

const ctxFor = (role: Role): AuthContext =>
  ({ organizationId: ORG_ID, userId: USER_ID, role }) as AuthContext

function seedEscalated(overrides?: Partial<InboxItem>): InboxItem {
  return {
    id: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: propertyId('prop-1'),
    sourceType: 'review',
    sourceId: reviewId('rev-1'),
    status: 'open',
    rating: 4,
    sourceDate: new Date('2026-04-10'),
    platform: 'google',
    snippet: 'Great!',
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    isEscalated: true,
    escalatedAt: new Date('2026-04-11'),
    escalatedBy: USER_ID,
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

const allAccess: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
}

const setup = () => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const useCase = resolveEscalation({
    repo,
    events,
    clock: () => FIXED_TIME,
    staffPublicApi: allAccess,
  })
  return { useCase, repo, events }
}

describe('resolveEscalation', () => {
  it('clears the escalation flag', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedEscalated())

    const updated = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(updated.isEscalated).toBe(false)
    expect(updated.escalationResolvedAt).toBe(FIXED_TIME)
    expect(updated.escalationResolvedBy).toBe(USER_ID)
  })

  it('emits the escalation_resolved event', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedEscalated())

    await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('inbox.inbox_item.escalation_resolved')
  })

  it('is idempotent when not actively escalated', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedEscalated({ isEscalated: false }))

    await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(events.capturedEvents).toHaveLength(0)
  })

  it('does not change status', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedEscalated({ status: 'closed' }))

    const updated = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(updated.status).toBe('closed')
  })

  it('throws not_found for missing item', async () => {
    const { useCase } = setup()

    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
  })
})
