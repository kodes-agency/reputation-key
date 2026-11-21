// Private-feedback handling server functions, called as signed-in members over
// PostgreSQL with the real tenant resolution, execution policy and Inbox API.
// The commands' rules sit in use-cases/feedback-handling.integration.test.ts;
// this file holds the boundary: who may call, the flat revision fences, the
// returned conflict and the rows left behind.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'
import type { TestInboxItem } from '#/shared/testing/server-function-review-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  correctFeedbackHandlingOutcomeFn,
  markFeedbackHandledFn,
} from './inbox-feedback-handling'

const harness = setupServerFunctionHarness({
  cleanupTables: [...REVIEW_SEED_TABLES],
})

const FENCES = {
  expectedCommandRevision: 1,
  expectedCycleNumber: 1,
  expectedSourceRevision: 1,
  expectedStateRevision: 1,
} as const

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  const item = await harness.seedInboxItem({ feedback: property }, { rating: 2 })
  return { organization, admin, manager, property, item }
}

async function stored(item: TestInboxItem) {
  const { rows } = await harness.pool().query<{
    status: string
    command_revision: string
  }>(`SELECT status, command_revision FROM inbox_items WHERE id = $1`, [item.id])
  return rows[0]!
}

async function outcomes(item: TestInboxItem) {
  const { rows } = await harness.pool().query<{
    id: string
    outcome: string
    outcome_revision: string
    internal_note: string | null
    recorded_by: string
  }>(
    `SELECT id, outcome, outcome_revision, internal_note, recorded_by
       FROM inbox_feedback_handling_outcomes
      WHERE inbox_item_id = $1 ORDER BY outcome_revision`,
    [item.id],
  )
  return rows
}

describe('markFeedbackHandledFn', () => {
  it('is a POST', () => {
    expect(markFeedbackHandledFn).toHaveProperty('method', 'POST')
    expect(correctFeedbackHandlingOutcomeFn).toHaveProperty('method', 'POST')
  })

  it('closes the item for an AccountAdmin and stores the outcome without a note', async () => {
    const { admin, item } = await hotel()

    await harness.callAs(admin, () =>
      markFeedbackHandledFn({
        data: { inboxItemId: item.id, outcome: 'follow_up_completed', ...FENCES },
      }),
    )

    expect(await stored(item)).toMatchObject({ status: 'closed', command_revision: '2' })
    expect(await outcomes(item)).toEqual([
      expect.objectContaining({
        outcome: 'follow_up_completed',
        outcome_revision: '1',
        internal_note: null,
        recorded_by: admin.userId,
      }),
    ])
  })

  it('keeps the internal note a PropertyManager gives, on a granted Property', async () => {
    const { manager, item } = await hotel()

    await harness.callAs(manager, () =>
      markFeedbackHandledFn({
        data: {
          inboxItemId: item.id,
          outcome: 'follow_up_attempted',
          internalNote: 'Guest confirmed the issue was resolved.',
          ...FENCES,
        },
      }),
    )

    expect(await outcomes(item)).toEqual([
      expect.objectContaining({
        outcome: 'follow_up_attempted',
        internal_note: 'Guest confirmed the issue was resolved.',
        recorded_by: manager.userId,
      }),
    ])
  })

  it('returns the current revision as a result when the fence is stale', async () => {
    const { admin, item } = await hotel()

    const result = await harness.callAs(admin, () =>
      markFeedbackHandledFn({
        data: {
          inboxItemId: item.id,
          outcome: 'follow_up_completed',
          ...FENCES,
          expectedCommandRevision: 7,
        },
      }),
    )

    expect(result).toEqual({
      ok: false,
      code: 'revision_conflict',
      currentCommandRevision: 1,
      currentStatus: 'open',
    })
    expect(await outcomes(item)).toEqual([])
    expect(await stored(item)).toMatchObject({ status: 'open', command_revision: '1' })
  })

  it('refuses a missing fence before reading anything', async () => {
    const { admin, item } = await hotel()

    await expect(
      harness.callAs(admin, (): Promise<unknown> =>
        markFeedbackHandledFn({
          data: {
            inboxItemId: item.id,
            outcome: 'follow_up_completed',
            expectedCycleNumber: 1,
            expectedSourceRevision: 1,
            expectedStateRevision: 1,
          } as never,
        }),
      ),
    ).rejects.toThrow(/expectedCommandRevision/)
    expect(await outcomes(item)).toEqual([])
  })

  it('refuses a PropertyManager without a grant on the Property and writes nothing', async () => {
    const { organization, item } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        markFeedbackHandledFn({
          data: { inboxItemId: item.id, outcome: 'follow_up_completed', ...FENCES },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(await stored(item)).toMatchObject({ status: 'open', command_revision: '1' })
    expect(await outcomes(item)).toEqual([])
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, item } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () =>
        markFeedbackHandledFn({
          data: { inboxItemId: item.id, outcome: 'follow_up_completed', ...FENCES },
        }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    expect(await outcomes(item)).toEqual([])
  })

  it('does not find the item for an AccountAdmin of another Organization', async () => {
    const { item } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        markFeedbackHandledFn({
          data: { inboxItemId: item.id, outcome: 'follow_up_completed', ...FENCES },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 })
    expect(await outcomes(item)).toEqual([])
  })

  it('refuses a Review item as invalid input', async () => {
    const { admin, property } = await hotel()
    const review = await harness.seedReview(property)
    const reviewItem = await harness.seedInboxItem({ review })

    await expect(
      harness.callAs(admin, () =>
        markFeedbackHandledFn({
          data: { inboxItemId: reviewItem.id, outcome: 'follow_up_completed', ...FENCES },
        }),
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(await stored(reviewItem)).toMatchObject({ status: 'open' })
  })

  it('refuses a caller with no session', async () => {
    const { item } = await hotel()

    await expect(
      harness.callAs(null, () =>
        markFeedbackHandledFn({
          data: { inboxItemId: item.id, outcome: 'follow_up_completed', ...FENCES },
        }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })
})

describe('correctFeedbackHandlingOutcomeFn', () => {
  async function handled() {
    const scene = await hotel()
    await harness.callAs(scene.admin, () =>
      markFeedbackHandledFn({
        data: { inboxItemId: scene.item.id, outcome: 'follow_up_attempted', ...FENCES },
      }),
    )
    const [first] = await outcomes(scene.item)
    return { ...scene, firstOutcomeId: first!.id }
  }

  it('appends a superseding outcome on the exact fact and keeps the item closed', async () => {
    const { admin, item, firstOutcomeId } = await handled()

    await harness.callAs(admin, () =>
      correctFeedbackHandlingOutcomeFn({
        data: {
          inboxItemId: item.id,
          outcome: 'follow_up_completed',
          expectedCommandRevision: 2,
          expectedCycleNumber: 1,
          expectedSourceRevision: 1,
          expectedStateRevision: 2,
          expectedOutcomeId: firstOutcomeId,
          expectedOutcomeRevision: 1,
        },
      }),
    )

    expect((await stored(item)).status).toBe('closed')
    expect(await outcomes(item)).toEqual([
      expect.objectContaining({ outcome: 'follow_up_attempted', outcome_revision: '1' }),
      expect.objectContaining({ outcome: 'follow_up_completed', outcome_revision: '2' }),
    ])
  })

  it('returns a conflict result when the outcome revision is stale', async () => {
    const { admin, item, firstOutcomeId } = await handled()

    const result = await harness.callAs(admin, () =>
      correctFeedbackHandlingOutcomeFn({
        data: {
          inboxItemId: item.id,
          outcome: 'follow_up_completed',
          expectedCommandRevision: 1,
          expectedCycleNumber: 1,
          expectedSourceRevision: 1,
          expectedStateRevision: 2,
          expectedOutcomeId: firstOutcomeId,
          expectedOutcomeRevision: 1,
        },
      }),
    )

    expect(result).toMatchObject({
      ok: false,
      code: 'revision_conflict',
      currentCommandRevision: 2,
      currentStatus: 'closed',
    })
    expect(await outcomes(item)).toHaveLength(1)
  })

  it('refuses a PropertyManager without a grant and writes nothing', async () => {
    const { organization, item, firstOutcomeId } = await handled()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        correctFeedbackHandlingOutcomeFn({
          data: {
            inboxItemId: item.id,
            outcome: 'follow_up_completed',
            expectedCommandRevision: 2,
            expectedCycleNumber: 1,
            expectedSourceRevision: 1,
            expectedStateRevision: 2,
            expectedOutcomeId: firstOutcomeId,
            expectedOutcomeRevision: 1,
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(await outcomes(item)).toHaveLength(1)
  })
})
