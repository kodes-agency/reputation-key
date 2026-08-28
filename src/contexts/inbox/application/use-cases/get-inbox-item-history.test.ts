import { describe, expect, it, vi } from 'vitest'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  feedbackId,
  userId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type { InboxHistoryEntry } from '../../domain/handling-history'
import { isInboxError } from '../../domain/errors'
import type { InboxHistoryRepository } from '../ports/inbox-history.repository'
import { getInboxItemHistory } from './get-inbox-item-history'

const ORG_ID = organizationId('org-1')
const ITEM_ID = inboxItemId('item-1')
const PROP_ID = propertyId('prop-1')
const OTHER_PROP_ID = propertyId('prop-2')
const ACTOR_ID = userId('user-actor')
const ASSIGNEE_ID = userId('user-assignee')
const AT = new Date('2026-04-15T12:00:00Z')

const adminStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const scopedStaffApi = (ids: ReadonlyArray<string>): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids.map(propertyId),
  getAssignedPortals: async () => [],
})

const makeItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  sourceType: 'feedback' as SourceType,
  sourceId: feedbackId('fb-1'),
  status: 'open' as InboxStatus,
  rating: null,
  sourceDate: AT,
  platform: 'portal',
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
  commandRevision: 1,
  createdAt: AT,
  updatedAt: AT,
  ...overrides,
})

type Scope = 'organization' | 'assigned-properties'

const ctxWith = (
  permissions: readonly Permission[],
  scopes: Partial<Record<Permission, Scope>> = {},
): AuthContext =>
  ({
    organizationId: ORG_ID,
    userId: ACTOR_ID,
    role: 'Staff',
    effectivePermissions: new Set(permissions),
    scopeByPermission: new Map(
      permissions.map((permission) => [permission, scopes[permission] ?? 'organization']),
    ),
  }) as AuthContext

const at = (offsetMs: number) => new Date(AT.getTime() + offsetMs)

/**
 * A three-cycle private-feedback item: initial submission, a source-revision
 * supersession, and a manual reopen — plus the assignment, escalation and
 * outcome facts recorded alongside them.
 */
const HISTORY: readonly InboxHistoryEntry[] = [
  {
    id: 'cycle:item-1:1',
    inboxItemId: ITEM_ID,
    kind: 'cycle_opened',
    occurredAt: at(0),
    cycleNumber: 1,
    stateRevision: null,
    actorUserId: null,
    actorDisplayName: null,
    legacy: false,
    detail: {
      kind: 'cycle_opened',
      openedReason: 'feedback_submitted',
      manualReopenReason: null,
      manualReopenExplanation: null,
      supersedesCycleNumber: null,
      sourceRevision: 1,
    },
  },
  {
    id: 'transition:item-1:2',
    inboxItemId: ITEM_ID,
    kind: 'cycle_transition',
    occurredAt: at(1000),
    cycleNumber: 1,
    stateRevision: 2,
    actorUserId: ACTOR_ID,
    actorDisplayName: null,
    legacy: false,
    detail: {
      kind: 'cycle_transition',
      transition: 'closed',
      transitionReason: 'private_feedback_handled',
      actorType: 'user',
    },
  },
  {
    // Same instant as the close transition it completes: the tie-break must be
    // the stable discriminator, not query arrival order.
    id: 'outcome:outcome-1:1',
    inboxItemId: ITEM_ID,
    kind: 'handling_outcome',
    occurredAt: at(1000),
    cycleNumber: 1,
    stateRevision: 2,
    actorUserId: ACTOR_ID,
    actorDisplayName: null,
    legacy: false,
    detail: {
      kind: 'handling_outcome',
      outcome: 'follow_up_completed',
      outcomeRevision: 1,
      deadlineResult: 'on_time',
      completionAt: at(1000),
      supersedesOutcomeId: null,
      internalNote: 'Duty manager handled it personally',
    },
  },
  {
    id: 'assignment:item-1:3',
    inboxItemId: ITEM_ID,
    kind: 'assignment',
    occurredAt: at(2000),
    cycleNumber: 1,
    stateRevision: null,
    actorUserId: ACTOR_ID,
    actorDisplayName: null,
    legacy: false,
    detail: {
      kind: 'assignment',
      reason: 'assign',
      previousAssignee: null,
      nextAssignee: ASSIGNEE_ID,
      previousAssigneeDisplayName: null,
      nextAssigneeDisplayName: null,
      bulkId: null,
    },
  },
  {
    id: 'escalation:item-1:4',
    inboxItemId: ITEM_ID,
    kind: 'escalation',
    occurredAt: at(3000),
    cycleNumber: 2,
    stateRevision: null,
    actorUserId: ACTOR_ID,
    actorDisplayName: null,
    legacy: false,
    detail: { kind: 'escalation', escalation: 'escalated' },
  },
  {
    id: 'cycle:item-1:0',
    inboxItemId: ITEM_ID,
    kind: 'cycle_opened',
    occurredAt: at(-1000),
    cycleNumber: 0,
    stateRevision: null,
    // A legacy backfill row: the repository already stripped any actor.
    actorUserId: null,
    actorDisplayName: null,
    legacy: true,
    detail: {
      kind: 'cycle_opened',
      openedReason: 'legacy_backfill',
      manualReopenReason: null,
      manualReopenExplanation: null,
      supersedesCycleNumber: null,
      sourceRevision: 1,
    },
  },
]

function createHistoryRepo(entries: readonly InboxHistoryEntry[] = HISTORY) {
  const findByInboxItemId = vi.fn(async () => ({ entries, truncated: false }))
  return { repo: { findByInboxItemId } as InboxHistoryRepository, findByInboxItemId }
}

function createActorDirectory(
  names: ReadonlyMap<string, string> = new Map([
    [ACTOR_ID as string, 'Ada Lovelace'],
    [ASSIGNEE_ID as string, 'Grace Hopper'],
  ]),
) {
  const calls: ReadonlyArray<string>[] = []
  return {
    calls,
    resolveDisplayNames: async (
      _organizationId: OrganizationId,
      userIds: readonly UserId[],
    ) => {
      calls.push(userIds.map(String))
      return new Map(
        userIds.flatMap((id) => {
          const name = names.get(String(id))
          return name === undefined ? [] : [[id, name] as const]
        }),
      )
    },
  }
}

function build(
  overrides: Partial<{
    item: InboxItem
    staffPublicApi: StaffPublicApi
    entries: readonly InboxHistoryEntry[]
  }> = {},
) {
  const repo = createInMemoryInboxRepo()
  repo.items.push(overrides.item ?? makeItem())
  const history = createHistoryRepo(overrides.entries)
  const actorDirectory = createActorDirectory()
  const useCase = getInboxItemHistory({
    historyRepo: history.repo,
    repo,
    staffPublicApi: overrides.staffPublicApi ?? adminStaffApi,
    actorDirectory,
  })
  return { useCase, history, actorDirectory }
}

const FULL_READER = ctxWith(['inbox.read', 'feedback.read'])
const FULL_HANDLER = ctxWith([
  'inbox.read',
  'feedback.read',
  'inbox.write',
  'feedback.handle',
])

describe('getInboxItemHistory', () => {
  it('requires inbox.read', async () => {
    const { useCase, history } = build()

    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxWith(['feedback.read'])),
    ).rejects.toSatisfy((error) => isInboxError(error) && error.code === 'forbidden')
    expect(history.findByInboxItemId).not.toHaveBeenCalled()
  })

  it('requires the source read permission and never touches the store without it', async () => {
    const { useCase, history } = build()

    // inbox.read alone is not enough for a private-feedback item.
    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxWith(['inbox.read'])),
    ).rejects.toSatisfy((error) => isInboxError(error) && error.code === 'forbidden')
    expect(history.findByInboxItemId).not.toHaveBeenCalled()
  })

  it('rejects a caller whose Property scope excludes the item', async () => {
    const { useCase, history } = build({
      staffPublicApi: scopedStaffApi([OTHER_PROP_ID]),
    })
    const assignedElsewhere = ctxWith(['inbox.read', 'feedback.read'], {
      'inbox.read': 'assigned-properties',
      'feedback.read': 'assigned-properties',
    })

    await expect(useCase({ inboxItemId: ITEM_ID }, assignedElsewhere)).rejects.toSatisfy(
      (error) => isInboxError(error) && error.code === 'forbidden',
    )
    expect(history.findByInboxItemId).not.toHaveBeenCalled()
  })

  it('throws not_found for an item outside the caller Organization', async () => {
    const repo = createInMemoryInboxRepo()
    const history = createHistoryRepo()
    const useCase = getInboxItemHistory({
      historyRepo: history.repo,
      repo,
      staffPublicApi: adminStaffApi,
      actorDirectory: createActorDirectory(),
    })

    await expect(useCase({ inboxItemId: ITEM_ID }, FULL_READER)).rejects.toSatisfy(
      (error) => isInboxError(error) && error.code === 'not_found',
    )
  })

  it('returns one ordered stream merged from every source', async () => {
    const { useCase } = build()

    const result = await useCase({ inboxItemId: ITEM_ID }, FULL_HANDLER)

    expect(result.entries.map((entry) => entry.id)).toEqual([
      // Earliest instant first; the legacy backfill row precedes cycle one.
      'cycle:item-1:0',
      'cycle:item-1:1',
      // Same instant, same cycle, same state revision — the stable
      // discriminator puts the transition before the outcome it completes.
      'transition:item-1:2',
      'outcome:outcome-1:1',
      'assignment:item-1:3',
      'escalation:item-1:4',
    ])
    expect(result.truncated).toBe(false)
    expect(result.inboxItemId).toBe(ITEM_ID)
  })

  it('returns the internal note only to a current inbox.write + feedback.handle caller', async () => {
    const { useCase } = build()

    const authorized = await useCase({ inboxItemId: ITEM_ID }, FULL_HANDLER)
    const outcome = authorized.entries.find((entry) => entry.kind === 'handling_outcome')!
    expect(outcome.detail).toMatchObject({
      internalNote: 'Duty manager handled it personally',
    })
  })

  it('omits the internal note field entirely for a read-only caller', async () => {
    const { useCase } = build()

    const readOnly = await useCase({ inboxItemId: ITEM_ID }, FULL_READER)
    const outcome = readOnly.entries.find((entry) => entry.kind === 'handling_outcome')!

    // Absent, not null: the reader cannot infer that a note exists at all.
    expect(Object.hasOwn(outcome.detail, 'internalNote')).toBe(false)
    expect(JSON.stringify(readOnly.entries)).not.toContain('Duty manager')
  })

  it('withholds the note when handling authority does not cover the item Property', async () => {
    // Org-wide read, but handling authority assigned to a different Property:
    // the history is returned and the manager-internal note is not.
    const { useCase } = build({ staffPublicApi: scopedStaffApi([OTHER_PROP_ID]) })
    const readsWidelyHandlesElsewhere = ctxWith(
      ['inbox.read', 'feedback.read', 'inbox.write', 'feedback.handle'],
      { 'inbox.write': 'assigned-properties', 'feedback.handle': 'assigned-properties' },
    )

    const result = await useCase({ inboxItemId: ITEM_ID }, readsWidelyHandlesElsewhere)

    expect(result.entries.length).toBeGreaterThan(0)
    const outcome = result.entries.find((entry) => entry.kind === 'handling_outcome')!
    expect(Object.hasOwn(outcome.detail, 'internalNote')).toBe(false)
  })

  it('labels the legacy row and infers no actor, outcome, or deadline result for it', async () => {
    const { useCase } = build()

    const result = await useCase({ inboxItemId: ITEM_ID }, FULL_HANDLER)
    const legacy = result.entries.find((entry) => entry.legacy)!

    expect(legacy.detail.kind).toBe('cycle_opened')
    expect(legacy.actorUserId).toBeNull()
    expect(legacy.actorDisplayName).toBeNull()
    expect(legacy.detail).not.toHaveProperty('outcome')
    expect(legacy.detail).not.toHaveProperty('deadlineResult')
  })

  it('resolves actor and assignee display names in exactly one batched call', async () => {
    const { useCase, actorDirectory } = build()

    const result = await useCase({ inboxItemId: ITEM_ID }, FULL_HANDLER)

    expect(actorDirectory.calls).toHaveLength(1)
    expect([...actorDirectory.calls[0]].sort()).toEqual(['user-actor', 'user-assignee'])
    const assignment = result.entries.find((entry) => entry.kind === 'assignment')!
    expect(assignment.actorDisplayName).toBe('Ada Lovelace')
    expect(assignment.detail).toMatchObject({
      previousAssigneeDisplayName: null,
      nextAssigneeDisplayName: 'Grace Hopper',
    })
  })

  it('reports truncation instead of pretending the story is whole', async () => {
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem())
    const useCase = getInboxItemHistory({
      historyRepo: {
        findByInboxItemId: async () => ({ entries: HISTORY, truncated: true }),
      },
      repo,
      staffPublicApi: adminStaffApi,
      actorDirectory: createActorDirectory(),
    })

    await expect(useCase({ inboxItemId: ITEM_ID }, FULL_READER)).resolves.toMatchObject({
      truncated: true,
    })
  })

  it('applies the review source permission for a review item', async () => {
    const { useCase, history } = build({
      item: makeItem({ sourceType: 'review', sourceId: reviewId('rev-1') }),
    })

    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxWith(['inbox.read', 'feedback.read'])),
    ).rejects.toSatisfy((error) => isInboxError(error) && error.code === 'forbidden')
    expect(history.findByInboxItemId).not.toHaveBeenCalled()

    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxWith(['inbox.read', 'review.read'])),
    ).resolves.toMatchObject({ inboxItemId: ITEM_ID })
  })
})
