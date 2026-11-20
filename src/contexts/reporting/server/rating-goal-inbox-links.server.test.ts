// The rating goal detail links its low reviews to the Inbox only for a viewer the
// execution policy lets read it. An Organization without the inbox.use capability
// holds goal.read alone, and the built-in roles hold both, so no journey over the
// harness can reach the refusal: it is asserted here.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { DataScope } from '#/shared/domain/data-scope'
import type { Permission } from '#/shared/domain/permissions'
import type { RatingGoalDetailRead } from '../rating-goals/contracts'

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  getReviewInboxItemIds: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    inboxPublicApi: { getReviewInboxItemIds: mocks.getReviewInboxItemIds },
    clock: () => new Date('2026-10-14T12:00:00.000Z'),
  }),
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  getExecutionPolicy: () => ({ decide: mocks.decide }),
}))

import { withInboxItems } from './rating-goal-inbox-links.server'

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const GOAL_ID = '00000000-0000-4000-8000-000000000003'
const REVIEW_A = '60000000-0000-4000-8000-00000000000a'
const REVIEW_B = '60000000-0000-4000-8000-00000000000b'
const ITEM_A = '70000000-0000-4000-8000-00000000000a'

const viewer = {
  organizationId: ORG_ID,
  userId: 'manager-1',
  role: 'PropertyManager',
  effectivePermissions: new Set<Permission>(['goal.read']),
  scopeByPermission: new Map<Permission, DataScope>([
    ['goal.read', 'assigned-properties'],
  ]),
} as unknown as AuthContext

const detail = {
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
} as unknown as RatingGoalDetailRead

describe('withInboxItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('gives a viewer the policy refuses inbox.read the rows without links and asks the Inbox nothing', async () => {
    // Arrange
    mocks.decide.mockResolvedValue({ allowed: false, reason: 'capability_disabled' })

    // Act
    const view = await withInboxItems(detail, PROPERTY_ID, viewer)

    // Assert
    expect(view.moved.lowReviews).toEqual([
      { inboxItemId: null, at: '2026-10-13T08:00:00.000Z', stars: 2, setBack: 8 },
      { inboxItemId: null, at: '2026-10-10T08:00:00.000Z', stars: 1, setBack: 11 },
    ])
    expect(JSON.stringify(view)).not.toContain('reviewId')
    expect(JSON.stringify(view)).not.toContain(REVIEW_A)
    expect(mocks.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'user', ctx: viewer },
        action: 'inbox.read',
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        executionKind: 'interactive',
      }),
    )
    expect(mocks.getReviewInboxItemIds).not.toHaveBeenCalled()
  })

  it('links each row to its Inbox item in one lookup when the policy allows inbox.read', async () => {
    // Arrange
    mocks.decide.mockResolvedValue({ allowed: true })
    mocks.getReviewInboxItemIds.mockResolvedValue(new Map([[REVIEW_A, ITEM_A]]))

    // Act
    const view = await withInboxItems(detail, PROPERTY_ID, viewer)

    // Assert
    expect(view.moved.lowReviews.map((row) => row.inboxItemId)).toEqual([ITEM_A, null])
    expect(JSON.stringify(view)).not.toContain('reviewId')
    expect(mocks.getReviewInboxItemIds).toHaveBeenCalledTimes(1)
    expect(mocks.getReviewInboxItemIds).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID, reviewIds: [REVIEW_A, REVIEW_B] },
      viewer,
    )
  })

  it('makes no policy decision and no lookup when there is no low review', async () => {
    // Act
    const view = await withInboxItems(
      { ...detail, moved: { ...detail.moved, lowReviews: [] } },
      PROPERTY_ID,
      viewer,
    )

    // Assert
    expect(view.moved.lowReviews).toEqual([])
    expect(mocks.decide).not.toHaveBeenCalled()
    expect(mocks.getReviewInboxItemIds).not.toHaveBeenCalled()
  })
})
