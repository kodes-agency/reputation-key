import { describe, it, expect } from 'vitest'
import { resolveEscalation } from './resolve-escalation'
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
import type { InboxItem } from '../../domain/types'
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
  const events = createRecordedOutbox()
  const commandStore = createSequentialInboxCommandStore({ repo, outbox: events })
  const execute = resolveEscalation({
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

describe('resolveEscalation', () => {
  it('clears the escalation flag', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedEscalated())

    const updated = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(updated.isEscalated).toBe(false)
    expect(updated.escalationResolvedAt).toBe(FIXED_TIME)
    expect(updated.escalationResolvedBy).toBe(USER_ID)
    expect(updated.commandRevision).toBe(2)
  })

  it('records the escalation_resolved fact', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedEscalated())

    await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    const facts = events.facts
    expect(facts).toHaveLength(1)
    expect(facts[0]._tag).toBe('inbox.inbox_item.escalation_resolved')
  })

  it('is idempotent when not actively escalated', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedEscalated({ isEscalated: false }))

    await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(events.facts).toHaveLength(0)
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

  it('requires feedback.handle to resolve private-feedback escalation', async () => {
    const { useCase, repo } = setup()
    repo.items.push(
      seedEscalated({ sourceType: 'feedback', sourceId: feedbackId('fb-private') }),
    )

    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxWith('inbox.write', 'feedback.read')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
  })

  it('intersects feedback.handle scope before resolving escalation', async () => {
    const { useCase, repo } = setup({
      ...allAccess,
      getAccessiblePropertyIds: async () => [propertyId('prop-other')],
    })
    repo.items.push(
      seedEscalated({ sourceType: 'feedback', sourceId: feedbackId('fb-private') }),
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
