// "Try publishing again" (retryPublishFn) and "Check Google again"
// (checkReplyPublicationFn), called as signed-in members over PostgreSQL with
// the real tenant resolution, execution policy and Review API. Both are POST
// mutations taking only a review id; a refusal reaches the manager with its
// HTTP status and its sentence. The state machine behind them is covered by
// the use-case suites; this file holds the boundary.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'
import type {
  SeedReplyOptions,
  TestReview,
} from '#/shared/testing/server-function-review-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { checkReplyPublicationFn, retryPublishFn } from './reply'

const harness = setupServerFunctionHarness({
  cleanupTables: ['outbox_events', ...REVIEW_SEED_TABLES],
})

const FUNCTIONS = [
  ['retryPublishFn', retryPublishFn],
  ['checkReplyPublicationFn', checkReplyPublicationFn],
] as const

const PUBLISHED: SeedReplyOptions = { status: 'published', publicationState: 'published' }

async function hotel(reply: SeedReplyOptions = PUBLISHED, google = false) {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const property = await harness.seedProperty(organization, { google })
  const review = await harness.seedReview(property)
  const seeded = await harness.seedReply(review, { authorUserId: admin.userId, ...reply })
  return { organization, admin, property, review, reply: seeded }
}

async function storedReply(review: TestReview) {
  const { rows } = await harness.pool().query<{
    status: string
    publication_state: string | null
    publication_cycle: string
    state_revision: string
  }>(
    `SELECT status, publication_state, publication_cycle, state_revision
       FROM replies WHERE review_id = $1`,
    [review.id],
  )
  return rows[0]
}

describe('reply publication server functions', () => {
  it.each(FUNCTIONS)('%s is declared as a POST mutation', (_name, fn) => {
    expect(fn).toHaveProperty('method', 'POST')
  })

  it.each(FUNCTIONS)(
    '%s rejects a non-UUID review id and changes nothing',
    async (_name, fn) => {
      const { admin, review } = await hotel()
      const before = await storedReply(review)

      await expect(
        harness.callAs(admin, (): Promise<unknown> =>
          fn({ data: { reviewId: 'not-a-uuid' } }),
        ),
      ).rejects.toThrow(/reviewId/u)
      expect(await storedReply(review)).toEqual(before)
    },
  )

  it.each(FUNCTIONS)(
    '%s refuses a PropertyManager without a grant on the Property and changes nothing',
    async (_name, fn) => {
      const { organization, review } = await hotel()
      const manager = await harness.seedMember(organization, 'PropertyManager')
      const before = await storedReply(review)

      await expect(
        harness.callAs(manager, (): Promise<unknown> =>
          fn({ data: { reviewId: review.id } }),
        ),
      ).rejects.toMatchObject({ status: 403 })
      expect(await storedReply(review)).toEqual(before)
    },
  )

  it.each(FUNCTIONS)('%s refuses a staff Member and a visitor', async (_name, fn) => {
    const { organization, review } = await hotel()
    const staff = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(staff, (): Promise<unknown> =>
        fn({ data: { reviewId: review.id } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    await expect(
      harness.callAs(null, (): Promise<unknown> => fn({ data: { reviewId: review.id } })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it.each(FUNCTIONS)(
    '%s does not find a review of another Organization',
    async (_name, fn) => {
      const { review } = await hotel()
      const other = await harness.seedOrganization()
      const outsider = await harness.seedMember(other, 'AccountAdmin')

      await expect(
        harness.callAs(outsider, (): Promise<unknown> =>
          fn({ data: { reviewId: review.id } }),
        ),
      ).rejects.toMatchObject({
        name: 'ReviewError',
        code: 'reply_not_found',
        status: 404,
      })
    },
  )

  it('checkReplyPublicationFn refuses a draft with a 400 that carries the sentence the manager reads', async () => {
    const { admin, review } = await hotel({ status: 'draft' })

    await expect(
      harness.callAs(admin, () =>
        checkReplyPublicationFn({ data: { reviewId: review.id } }),
      ),
    ).rejects.toMatchObject({
      name: 'ReviewError',
      code: 'invalid_transition',
      status: 400,
      message: 'This reply has nothing to check on Google.',
    })
  })

  it('retryPublishFn refuses a reply still waiting for approval with a 400', async () => {
    const { admin, review } = await hotel({ status: 'pending_approval' })
    const before = await storedReply(review)

    await expect(
      harness.callAs(admin, () => retryPublishFn({ data: { reviewId: review.id } })),
    ).rejects.toMatchObject({
      name: 'ReviewError',
      code: 'invalid_transition',
      status: 400,
    })
    expect(await storedReply(review)).toEqual(before)
  })

  it('retryPublishFn returns a settled published reply unchanged', async () => {
    const { admin, review, reply } = await hotel()
    const before = await storedReply(review)

    await expect(
      harness.callAs(admin, () => retryPublishFn({ data: { reviewId: review.id } })),
    ).resolves.toMatchObject({ id: reply.id, status: 'published' })
    expect(await storedReply(review)).toEqual(before)
  })

  it('checkReplyPublicationFn returns the check result, never a retry', async () => {
    const { admin, review, reply } = await hotel()
    const before = await storedReply(review)

    const result = await harness.callAs(admin, () =>
      checkReplyPublicationFn({ data: { reviewId: review.id } }),
    )

    expect(result).toEqual({
      reply: expect.objectContaining({ id: reply.id, status: 'published' }),
      outcome: 'live_on_google',
      checkedAt: expect.any(Date),
      nextAutomaticCheckAt: null,
    })
    expect(await storedReply(review)).toEqual(before)
    expect(harness.fakes().queues.default.enqueuedJobs).toEqual([])
  })

  it('checkReplyPublicationFn reports an unreachable Google as sync_failed', async () => {
    const { admin, review } = await hotel(
      {
        status: 'publish_failed',
        publicationState: 'ambiguous',
        publicationLastErrorClass: 'ambiguous',
        publicationAttempts: 1,
      },
      true,
    )

    await expect(
      harness.callAs(admin, () =>
        checkReplyPublicationFn({ data: { reviewId: review.id } }),
      ),
    ).rejects.toMatchObject({ code: 'sync_failed', status: 500 })
  })
})
