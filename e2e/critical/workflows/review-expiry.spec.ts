// BQC-6.5 item 8 — review expiry makes source content unavailable and
// removes copies. One expired + one fresh review on the same property.
//
// Transitions verified:
//   expired source → typed unavailable outcome: the property review list
//     shows only the fresh review; the expired item's inbox detail shows the
//     "source cache expired" copy with NO review text; dashboard aggregates
//     exclude the expired rating
//   purge (real worker path, purge-expired-reviews job) → the expired review
//     ROW is removed, its replies cascade, and the review.expired fact closes
//     the inbox item

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import {
  e2eRunId,
  cleanupE2eData,
  seedProperty,
  seedReview,
  seedInboxItemForReview,
  seedApprovedReply,
  getReviewById,
  getReplyById,
  getInboxItemById,
  callServerFnGet,
  enqueuePurgeExpiredReviews,
  waitFor,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-exp-'
const seed = requireE2eSeedState()

test.describe('Critical workflow: review expiry + purge', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('expired content is unavailable everywhere, then the purge removes copies', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const { propertyId } = await seedProperty({
      organizationId: seed.organizationId,
      name: `E2E Expiry Hotel ${e2eRunId}`,
      slug: `${PREFIX}prop-${e2eRunId}`,
    })
    const { reviewId: freshId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId,
      externalId: `${PREFIX}fresh-${e2eRunId}`,
      rating: 5,
      text: 'Fresh review body — still within retention.',
      reviewerName: 'Fresh Retention Reviewer',
    })
    const { reviewId: expiredId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId,
      externalId: `${PREFIX}expired-${e2eRunId}`,
      rating: 1,
      text: 'Expired review body — must never render.',
      reviewerName: 'Expired Retention Reviewer',
      contentExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
    })
    await seedInboxItemForReview({
      organizationId: seed.organizationId,
      propertyId,
      reviewId: freshId,
    })
    const { inboxItemId: expiredItemId } = await seedInboxItemForReview({
      organizationId: seed.organizationId,
      propertyId,
      reviewId: expiredId,
    })
    const { replyId: expiredReplyId } = await seedApprovedReply({
      organizationId: seed.organizationId,
      reviewId: expiredId,
      text: 'Draft reply on the expired review',
    })

    await signIn(page)

    // Review list: only the fresh review's content renders.
    await page.goto(`/properties/${propertyId}/reviews`)
    await expect(page.getByText('Fresh Retention Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('Expired Retention Reviewer')).toHaveCount(0)
    await expect(page.getByText('Expired review body — must never render.')).toHaveCount(
      0,
    )

    // Inbox detail on the expired item: typed unavailable outcome, no text.
    await page.goto(`/inbox?itemId=${expiredItemId}`)
    await expect(
      page.getByText('Review content unavailable (source cache expired)').first(),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Expired review body — must never render.')).toHaveCount(
      0,
    )

    // Dashboard aggregates exclude the expired review's 1★ (fresh is 5★).
    const dashboard = await callServerFnGet<{
      kpis: { avgRating: { value: number }; reviews: { value: number } }
      recentReviews: ReadonlyArray<{ id: string }>
    }>(page, {
      file: 'src/contexts/dashboard/server/dashboard.ts',
      exportName: 'getDashboardDataFn',
      data: { propertyId, timeRange: 'all' },
    })
    expect(dashboard.kpis.avgRating.value).toBe(5)
    expect(dashboard.kpis.reviews.value).toBe(1)
    expect(dashboard.recentReviews.map((r) => r.id)).not.toContain(expiredId)

    // Purge through the real worker path (the daily job, invoked on demand).
    await enqueuePurgeExpiredReviews()
    await waitFor(async () => ((await getReviewById(expiredId)) === null ? true : null), {
      timeoutMs: 30_000,
      description: 'expired review row purged',
    })
    // Copies removed: the expired review's reply cascades away…
    expect(await getReplyById(expiredReplyId)).toBeNull()
    // …the fresh review survives…
    expect(await getReviewById(freshId)).not.toBeNull()
    // …and the review.expired fact closed the inbox item (worker bus handler).
    await waitFor(
      async () => {
        const item = await getInboxItemById(expiredItemId)
        return item?.status === 'closed' ? item : null
      },
      { timeoutMs: 20_000, description: 'expired item closed via review.expired' },
    )
  })
})
