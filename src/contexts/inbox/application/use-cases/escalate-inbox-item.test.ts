import { describe, it, expect } from 'vitest'
import { escalateInboxItem } from './escalate-inbox-item'
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
import type { InboxItem, InboxStatus } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
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
    sourceType: 'review',
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
    commandRevision: 1,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  }
}

const allAccess: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const setup = (staffPublicApi: StaffPublicApi = allAccess) => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const commandStore = createSequentialInboxCommandStore({ repo, events })
  const execute = escalateInboxItem({
    repo,
    commandStore,
    clock: () => FIXED_TIME,
    staffPublicApi,
  })
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

describe('escalateInboxItem', () => {
  it('sets the escalation flag', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedOpen())

    const updated = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(updated.isEscalated).toBe(true)
    expect(updated.escalatedAt).toBe(FIXED_TIME)
    expect(updated.escalationResolvedAt).toBeNull()
    expect(updated.commandRevision).toBe(2)
  })

  it('emits the standalone escalated event (no oldStatus)', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedOpen())

    await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('inbox.inbox_item.escalated')
    expect(emitted[0]).not.toHaveProperty('oldStatus')
  })

  it('is idempotent when already actively escalated', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedOpen({ isEscalated: true, escalatedAt: FIXED_TIME }))

    const updated = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(updated.isEscalated).toBe(true)
    expect(events.capturedEvents).toHaveLength(0)
  })

  it('re-escalates a resolved escalation', async () => {
    const { useCase, repo } = setup()
    repo.items.push(
      seedOpen({
        isEscalated: false,
        escalationResolvedAt: new Date('2026-04-12'),
      }),
    )

    const updated = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(updated.isEscalated).toBe(true)
    expect(updated.escalationResolvedAt).toBeNull()
  })

  it('does not change status (escalation is orthogonal)', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedOpen({ status: 'closed' }))

    const updated = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(updated.status).toBe('closed')
    expect(updated.isEscalated).toBe(true)
  })

  it('throws not_found for missing item', async () => {
    const { useCase } = setup()

    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
  })

  it('denies access without inbox.write permission', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedOpen())

    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxFor('Guest' as unknown as Role)),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('requires feedback.handle to escalate private feedback', async () => {
    const { useCase, repo } = setup()
    repo.items.push(
      seedOpen({ sourceType: 'feedback', sourceId: feedbackId('fb-private') }),
    )

    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxWith('inbox.write', 'feedback.read')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
  })

  it('intersects feedback.handle scope before escalating', async () => {
    const { useCase, repo } = setup({
      ...allAccess,
      getAccessiblePropertyIds: async () => [propertyId('prop-other')],
    })
    repo.items.push(
      seedOpen({ sourceType: 'feedback', sourceId: feedbackId('fb-private') }),
    )

    await expect(
      useCase(
        { inboxItemId: ITEM_ID },
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
})
