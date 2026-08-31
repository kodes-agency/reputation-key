import { describe, expect, it, vi } from 'vitest'
import { bulkAssignInboxItems } from './bulk-assign-inbox-items'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createSequentialInboxCommandStore } from '#/shared/testing/sequential-inbox-command-store'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { isInboxError } from '../../domain/errors'

const NOW = new Date('2026-08-27T10:00:00.000Z')
const ORG = organizationId('org-1')
const ACTOR = userId('actor-1')
const ASSIGNEE = userId('assignee-1')
const PROP_A = propertyId('prop-a')
const PROP_B = propertyId('prop-b')
const BULK_ID = '6a000000-0000-4000-8000-000000000001'

const adminCtx = {
  organizationId: ORG,
  userId: ACTOR,
  role: 'AccountAdmin',
} as AuthContext

const item = (
  id: string,
  prop = PROP_A,
  assignedTo: ReturnType<typeof userId> | null = null,
): InboxItem => ({
  id: inboxItemId(id),
  organizationId: ORG,
  propertyId: prop,
  sourceType: 'feedback',
  sourceId: feedbackId(`feedback-${id}`),
  status: 'open',
  rating: 3,
  sourceDate: NOW,
  platform: null,
  snippet: null,
  assignedTo,
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
  createdAt: NOW,
  updatedAt: NOW,
})

const staffApi = (accessible: readonly ReturnType<typeof propertyId>[] | null) =>
  ({
    getAccessiblePropertyIds: async () => accessible,
    getAssignedPortals: async () => [],
  }) satisfies StaffPublicApi

const setup = (accessible: readonly ReturnType<typeof propertyId>[] | null = null) => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const commandStore = createSequentialInboxCommandStore({ repo, events })
  const execute = bulkAssignInboxItems({
    repo,
    commandStore,
    staffPublicApi: staffApi(accessible),
    clock: () => NOW,
    idGen: () => BULK_ID,
  })
  return { repo, events, commandStore, execute }
}

const commands = (...items: readonly InboxItem[]) =>
  items.map((entry) => ({
    inboxItemId: entry.id,
    expectedCommandRevision: entry.commandRevision,
  }))

describe('bulkAssignInboxItems', () => {
  it('assigns the complete set and closes it with one sorted content-free fact', async () => {
    const { repo, events, execute } = setup()
    const second = item('00000000-0000-4000-8000-000000000002', PROP_B)
    const first = item('00000000-0000-4000-8000-000000000001')
    repo.items.push(second, first)

    const result = await execute(
      { items: commands(second, first), assignedToUserId: ASSIGNEE },
      adminCtx,
    )

    expect(result).toEqual({
      updated: 2,
      bulkId: BULK_ID,
      results: [
        { inboxItemId: second.id, outcome: 'assigned' },
        { inboxItemId: first.id, outcome: 'assigned' },
      ],
    })
    expect(repo.items.map((entry) => entry.assignedTo)).toEqual([ASSIGNEE, ASSIGNEE])
    const perItem = events.capturedByTag('inbox.inbox_item.assigned')
    expect(perItem).toHaveLength(2)
    expect(perItem.every((fact) => fact.bulkId === BULK_ID)).toBe(true)
    expect(events.capturedByTag('inbox.inbox_items.bulk_assignment_completed')).toEqual([
      expect.objectContaining({
        bulkId: BULK_ID,
        count: 2,
        transitions: [
          expect.objectContaining({ inboxItemId: first.id, nextAssignee: ASSIGNEE }),
          expect.objectContaining({ inboxItemId: second.id, nextAssignee: ASSIGNEE }),
        ],
      }),
    ])
  })

  it('releases and reassigns with explicit per-item outcomes', async () => {
    const { repo, execute } = setup()
    const assigned = item('00000000-0000-4000-8000-000000000003', PROP_A, ASSIGNEE)
    repo.items.push(assigned)

    await expect(
      execute({ items: commands(assigned), assignedToUserId: null }, adminCtx),
    ).resolves.toMatchObject({
      updated: 1,
      results: [{ inboxItemId: assigned.id, outcome: 'released' }],
    })
  })

  it('does not write any row when one selected item is stale', async () => {
    const { repo, events, execute, commandStore } = setup()
    const first = item('00000000-0000-4000-8000-000000000004')
    const second = item('00000000-0000-4000-8000-000000000005', PROP_B)
    repo.items.push(first, { ...second, commandRevision: 2 })
    const storeCall = vi.spyOn(commandStore, 'bulkAssign')

    const result = await execute(
      { items: commands(first, second), assignedToUserId: ASSIGNEE },
      adminCtx,
    )

    expect(result).toEqual({
      updated: 0,
      bulkId: null,
      results: [
        { inboxItemId: first.id, outcome: 'batch_aborted' },
        { inboxItemId: second.id, outcome: 'revision_conflict' },
      ],
    })
    expect(storeCall).not.toHaveBeenCalled()
    expect(repo.items.every((entry) => entry.assignedTo === null)).toBe(true)
    expect(events.capturedByTag('inbox.inbox_item.assigned')).toEqual([])
  })

  it('does not disclose or mutate an inaccessible item and aborts the visible peer', async () => {
    const { repo, execute } = setup([PROP_A])
    const first = item('00000000-0000-4000-8000-000000000006')
    const second = item('00000000-0000-4000-8000-000000000007', PROP_B)
    repo.items.push(first, second)
    const scopedManager = { ...adminCtx, role: 'PropertyManager' } as AuthContext

    await expect(
      execute(
        { items: commands(first, second), assignedToUserId: ASSIGNEE },
        scopedManager,
      ),
    ).resolves.toEqual({
      updated: 0,
      bulkId: null,
      results: [
        { inboxItemId: first.id, outcome: 'batch_aborted' },
        { inboxItemId: second.id, outcome: 'unavailable' },
      ],
    })
    expect(repo.items.every((entry) => entry.assignedTo === null)).toBe(true)
  })

  it('keeps unchanged items in the validated batch without emitting a false transition', async () => {
    const { repo, events, execute } = setup()
    const current = item('00000000-0000-4000-8000-000000000008', PROP_A, ASSIGNEE)
    repo.items.push(current)

    await expect(
      execute({ items: commands(current), assignedToUserId: ASSIGNEE }, adminCtx),
    ).resolves.toEqual({
      updated: 0,
      bulkId: BULK_ID,
      results: [{ inboxItemId: current.id, outcome: 'unchanged' }],
    })
    expect(events.capturedByTag('inbox.inbox_item.assigned')).toEqual([])
    expect(events.capturedByTag('inbox.inbox_items.bulk_assignment_completed')).toEqual(
      [],
    )
  })

  it('rejects duplicate selections and callers without assignment management', async () => {
    const { repo, execute } = setup()
    const current = item('00000000-0000-4000-8000-000000000009')
    repo.items.push(current)
    await expect(
      execute(
        { items: commands(current, current), assignedToUserId: ASSIGNEE },
        adminCtx,
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
    await expect(
      execute({ items: commands(current), assignedToUserId: ASSIGNEE }, {
        ...adminCtx,
        role: 'Staff',
      } as AuthContext),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
  })
})
