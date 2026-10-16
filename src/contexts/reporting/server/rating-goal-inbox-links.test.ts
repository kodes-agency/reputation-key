// The rating goal detail's server function links the low reviews to the Inbox
// (PLAN-D D-2b, E17): one lookup after the policy allows inbox.read, never a
// review id in the answer, and rows without links for a viewer the policy
// refuses the Inbox (an Organization without the inbox.use capability; the
// built-in manager roles hold both, so no journey can show it).
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataScope } from '#/shared/domain/data-scope'
import type { Permission } from '#/shared/domain/permissions'
import type { GoalActor } from '../application/use-cases/goal-programs'

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  decide: vi.fn(),
  getReviewInboxItemIds: vi.fn(),
  answers: [] as unknown[],
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    goalPublicApi: { ratingGoals: { detail: mocks.detail } },
    inboxPublicApi: { getReviewInboxItemIds: mocks.getReviewInboxItemIds },
    clock: () => new Date('2026-10-14T12:00:00.000Z'),
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
  getExecutionPolicy: () => ({ decide: mocks.decide }),
}))
// Outside the Start compiler a server function call does not hand its
// handler's answer back to the caller, so the answer is kept here instead.
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    async (...args: unknown[]) => {
      const answer = await handler(...args)
      mocks.answers.push(answer)
      return answer
    },
}))

import { getRatingGoalDetail } from './rating-goals'

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const GOAL_ID = '00000000-0000-4000-8000-000000000003'
const manager: GoalActor = {
  organizationId: ORG_ID,
  userId: 'manager-1',
  role: 'PropertyManager',
  effectivePermissions: new Set<Permission>(['goal.read', 'inbox.read']),
  scopeByPermission: new Map<Permission, DataScope>([
    ['goal.read', 'assigned-properties'],
  ]),
}

type Answer = Readonly<{
  moved: Readonly<{ lowReviews: readonly Readonly<Record<string, unknown>>[] }>
}>

/** The detail as the browser gets it. */
async function readDetail(): Promise<Answer> {
  await withStartContext(() => getRatingGoalDetail({ data: { propertyId: PROPERTY_ID } }))
  return mocks.answers.at(-1) as Answer
}

describe('the detail’s low reviews, opened in the Inbox', () => {
  const REVIEW_A = '60000000-0000-4000-8000-00000000000a'
  const REVIEW_B = '60000000-0000-4000-8000-00000000000b'
  const ITEM_A = '70000000-0000-4000-8000-00000000000a'
  const read = {
    goalId: GOAL_ID,
    moved: {
      shownChanges: [],
      setBy: 'manager-1',
      initialTargetTenths: 45,
      initialPaceTenthsPerWeek: 110,
      thisWeek: { count: 1, allStars: 2, averageTenths: 20 },
      lowReviews: [
        { reviewId: REVIEW_A, at: '2026-10-13T08:00:00.000Z', stars: 2, setBack: 8 },
        { reviewId: REVIEW_B, at: '2026-10-10T08:00:00.000Z', stars: 1, setBack: 11 },
      ],
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.answers.length = 0
    mocks.resolveTenantContext.mockResolvedValue(manager)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.detail.mockResolvedValue(read)
  })

  it('links each row to its Inbox item in one lookup and sends no review id', async () => {
    // Arrange
    mocks.decide.mockResolvedValue({ allowed: true })
    mocks.getReviewInboxItemIds.mockResolvedValue(new Map([[REVIEW_A, ITEM_A]]))

    // Act
    const detail = await readDetail()

    // Assert
    expect(detail.moved.lowReviews).toEqual([
      { inboxItemId: ITEM_A, at: '2026-10-13T08:00:00.000Z', stars: 2, setBack: 8 },
      { inboxItemId: null, at: '2026-10-10T08:00:00.000Z', stars: 1, setBack: 11 },
    ])
    expect(JSON.stringify(detail)).not.toContain('reviewId')
    expect(JSON.stringify(detail)).not.toContain(REVIEW_A)
    expect(mocks.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'user', ctx: manager },
        action: 'inbox.read',
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        executionKind: 'interactive',
      }),
    )
    expect(mocks.getReviewInboxItemIds).toHaveBeenCalledTimes(1)
    expect(mocks.getReviewInboxItemIds).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID, reviewIds: [REVIEW_A, REVIEW_B] },
      manager,
    )
  })

  it('gives a viewer the policy refuses inbox.read the rows without links', async () => {
    // An Organization without the inbox.use capability: goal.read alone.
    mocks.decide.mockResolvedValue({ allowed: false, reason: 'capability_disabled' })

    const detail = await readDetail()

    expect(detail.moved.lowReviews.map((row) => row.inboxItemId)).toEqual([null, null])
    expect(JSON.stringify(detail)).not.toContain('reviewId')
    expect(mocks.getReviewInboxItemIds).not.toHaveBeenCalled()
  })

  it('asks the Inbox nothing when there is no low review', async () => {
    mocks.detail.mockResolvedValue({ ...read, moved: { ...read.moved, lowReviews: [] } })

    const detail = await readDetail()

    expect(detail.moved.lowReviews).toEqual([])
    expect(mocks.decide).not.toHaveBeenCalled()
    expect(mocks.getReviewInboxItemIds).not.toHaveBeenCalled()
  })
})
