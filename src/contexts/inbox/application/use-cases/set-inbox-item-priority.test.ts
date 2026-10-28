import { describe, it, expect } from 'vitest'
import { setInboxItemPriority } from './set-inbox-item-priority'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createSequentialInboxCommandStore } from '#/shared/testing/sequential-inbox-command-store'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import { isInboxError, PRIORITY_CHANGED_MESSAGE } from '../../domain/errors'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxPriority } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'

const NOW = new Date('2026-10-28T12:00:00Z')
const ORG_ID = organizationId('org-1')
const ITEM_ID = inboxItemId('ii-1')
const MANAGER = userId('user-maria')
const COLLEAGUE = userId('user-colleague')

const ctxWith = (...permissions: Permission[]): AuthContext => ({
  organizationId: ORG_ID,
  userId: MANAGER,
  role: 'Member',
  effectivePermissions: new Set(permissions),
  scopeByPermission: new Map(
    permissions.map((permission) => [permission, 'organization' as const]),
  ),
})

const manager = ctxWith('inbox.write', 'inbox.manage', 'review.read', 'feedback.handle')

function seed(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: propertyId('prop-1'),
    sourceType: 'review',
    sourceId: reviewId('rev-1'),
    status: 'open',
    rating: 2,
    sourceDate: new Date('2026-10-20'),
    platform: 'google',
    snippet: null,
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
    commandRevision: 3,
    createdAt: NOW,
    updatedAt: NOW,
    managerPriority: null,
    managerPrioritySetBy: null,
    managerPrioritySetAt: null,
    ...overrides,
  }
}

const allAccess: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

function setup(item: InboxItem = seed(), staffPublicApi: StaffPublicApi = allAccess) {
  const repo = createInMemoryInboxRepo()
  repo.items.push(item)
  const events = createRecordedOutbox()
  const commandStore = createSequentialInboxCommandStore({ repo, outbox: events })
  const execute = setInboxItemPriority({
    repo,
    commandStore,
    clock: () => NOW,
    staffPublicApi,
  })
  const run = (
    input: Readonly<{
      priority: InboxPriority | null
      expectedPriority?: InboxPriority | null
      expectedCommandRevision?: number
    }>,
    ctx: AuthContext = manager,
  ) =>
    execute(
      {
        inboxItemId: ITEM_ID,
        expectedCommandRevision:
          input.expectedCommandRevision ?? repo.items[0]!.commandRevision,
        expectedPriority:
          input.expectedPriority === undefined
            ? (repo.items[0]!.managerPriority ?? null)
            : input.expectedPriority,
        priority: input.priority,
      },
      ctx,
    )
  return { repo, events, run }
}

async function refusalOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!isInboxError(error))
    throw new Error(`expected an InboxError, got ${String(error)}`)
  return error
}

describe('setInboxItemPriority', () => {
  it('stores the level with who set it and when, and records one fact', async () => {
    const { run, events } = setup()

    const updated = await run({ priority: 'urgent' })

    expect(updated).toMatchObject({
      managerPriority: 'urgent',
      managerPrioritySetBy: MANAGER,
      managerPrioritySetAt: NOW,
      commandRevision: 4,
    })
    expect(events.facts).toHaveLength(1)
    expect(events.facts[0]).toMatchObject({
      _tag: 'inbox.inbox_item.priority_changed',
      inboxItemId: ITEM_ID,
      userId: MANAGER,
      source: 'web',
      priority: 'urgent',
      previousPriority: null,
    })
  })

  it('never opens, closes, assigns or escalates', async () => {
    const { run } = setup(
      seed({ status: 'closed', closedAt: NOW, assignedTo: COLLEAGUE }),
    )

    const updated = await run({ priority: 'high' })

    expect(updated).toMatchObject({
      status: 'closed',
      assignedTo: COLLEAGUE,
      isEscalated: false,
      escalatedAt: null,
    })
  })

  it('refuses without inbox.write', async () => {
    const { run, events } = setup()

    const error = await refusalOf(
      run({ priority: 'urgent' }, ctxWith('inbox.manage', 'review.read')),
    )

    expect(error.code).toBe('forbidden')
    expect(events.facts).toHaveLength(0)
  })

  it('refuses feedback without feedback.handle', async () => {
    const { run, events } = setup(
      seed({ sourceType: 'feedback', sourceId: feedbackId('fb-1'), platform: null }),
    )

    const error = await refusalOf(
      run(
        { priority: 'urgent' },
        ctxWith('inbox.write', 'inbox.manage', 'feedback.read'),
      ),
    )

    expect(error.code).toBe('forbidden')
    expect(events.facts).toHaveLength(0)
  })

  it('sets a level on private feedback, which has no suggestion of its own', async () => {
    const { run } = setup(
      seed({ sourceType: 'feedback', sourceId: feedbackId('fb-1'), platform: null }),
    )

    const updated = await run({ priority: 'high' })

    expect(updated.managerPriority).toBe('high')
  })

  it('checks Property scope before the revision', async () => {
    const otherProperty: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-elsewhere')],
      getAssignedPortals: async () => [],
    }
    const scoped = createScopedAuthContext({
      organizationId: ORG_ID,
      userId: MANAGER,
      permissions: [
        ['inbox.write', 'assigned-properties'],
        ['inbox.manage', 'assigned-properties'],
        ['review.read', 'assigned-properties'],
      ],
    })
    const { run } = setup(seed(), otherProperty)

    const error = await refusalOf(
      run({ priority: 'urgent', expectedCommandRevision: 1 }, scoped),
    )

    // Forbidden, not a conflict: a conflict would name the item's revision.
    expect(error.code).toBe('forbidden')
  })

  it('answers a stale revision with a revision conflict', async () => {
    const { run } = setup()

    const error = await refusalOf(run({ priority: 'urgent', expectedCommandRevision: 1 }))

    expect(error.code).toBe('revision_conflict')
  })

  it('refuses when a colleague changed the priority, and keeps their choice', async () => {
    const { run, repo, events } = setup(
      seed({
        managerPriority: 'low',
        managerPrioritySetBy: COLLEAGUE,
        managerPrioritySetAt: NOW,
      }),
    )

    // The pane read the item while nothing was set.
    const error = await refusalOf(run({ priority: 'urgent', expectedPriority: null }))

    expect(error.code).toBe('priority_changed')
    expect(error.message).toBe(PRIORITY_CHANGED_MESSAGE)
    expect(repo.items[0]!.managerPriority).toBe('low')
    expect(repo.items[0]!.managerPrioritySetBy).toBe(COLLEAGUE)
    expect(events.facts).toHaveLength(0)
  })

  it('is a silent no-op when a colleague already chose the same level', async () => {
    const { run, repo, events } = setup(
      seed({
        managerPriority: 'urgent',
        managerPrioritySetBy: COLLEAGUE,
        managerPrioritySetAt: NOW,
      }),
    )

    const result = await run({ priority: 'urgent', expectedPriority: null })

    expect(result.commandRevision).toBe(3)
    expect(repo.items[0]!.managerPrioritySetBy).toBe(COLLEAGUE)
    expect(events.facts).toHaveLength(0)
  })

  it('writes nothing when the picked level is the one already set', async () => {
    const { run, events } = setup(
      seed({
        managerPriority: 'medium',
        managerPrioritySetBy: MANAGER,
        managerPrioritySetAt: NOW,
      }),
    )

    const result = await run({ priority: 'medium' })

    expect(result.commandRevision).toBe(3)
    expect(events.facts).toHaveLength(0)
  })

  it('reset clears all three fields and records what it cleared', async () => {
    const { run, events } = setup(
      seed({
        managerPriority: 'low',
        managerPrioritySetBy: MANAGER,
        managerPrioritySetAt: NOW,
      }),
    )

    const updated = await run({ priority: null })

    expect(updated).toMatchObject({
      managerPriority: null,
      managerPrioritySetBy: null,
      managerPrioritySetAt: null,
    })
    expect(events.facts[0]).toMatchObject({ priority: null, previousPriority: 'low' })
  })

  it('treats resetting an item with no level as nothing to do', async () => {
    const { run, events } = setup()

    const result = await run({ priority: null })

    expect(result.commandRevision).toBe(3)
    expect(events.facts).toHaveLength(0)
  })
})
