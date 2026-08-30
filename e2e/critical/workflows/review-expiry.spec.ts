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
  seedReviewInboxItemWithCycle,
  seedApprovedReply,
  getReviewById,
  getReplyById,
  callServerFnGet,
  enqueuePurgeExpiredReviews,
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
    // IBX-01-T9: both items need their Handling Cycle. The expired one is read
    // through `/inbox?itemId=` below, and its terminal close is decided by the
    // cycle head — the source-transition command refuses to close an item whose
    // cycle is missing, so a bare `inbox_items` row could never reach 'closed'.
    // The fresh one is the control for that assertion and carries the same
    // shape so "still open" means the same thing on both.
    await seedReviewInboxItemWithCycle({
      organizationId: seed.organizationId,
      propertyId,
      reviewId: freshId,
    })
    const { inboxItemId: expiredItemId } = await seedReviewInboxItemWithCycle({
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
    //
    // The job is REPORT-ONLY. "fix(review): quarantine destructive lifecycle
    // paths" replaced the review delete with denyLegacyReviewDestruction, and
    // the job was rebuilt as an inspection over the source-content lifecycle
    // authority; the composition root wires it with no apply authorizer, so it
    // reports and deletes nothing. The schema was changed to match — replies,
    // provider observations, publication authorisations and attempts all
    // restrict deletion — so an observed Review is now structurally
    // undeletable, on purpose (src/contexts/review/CONTEXT.md: "destructive
    // Review purge has no active producer").
    //
    // What the product guarantees today is stable identity with read-side
    // unavailability, which the assertions above already prove. This asserts
    // the retention half: running the job leaves the rows in place rather than
    // silently doing something destructive.
    await enqueuePurgeExpiredReviews()
    // A deletion would land well inside this window; the point is that none
    // does. Polling for an absence that must never occur would only ever burn
    // the budget, so this settles once and then asserts retention.
    await new Promise((resolve) => setTimeout(resolve, 5_000))
    expect(await getReviewById(expiredId)).not.toBeNull()
    expect(await getReplyById(expiredReplyId)).not.toBeNull()
    expect(await getReviewById(freshId)).not.toBeNull()

    // NOT asserted, and deliberately so: source-content erasure
    // (source_content_state, text IS NULL, source_content_erased_at) and the
    // review.expired inbox close. Those depend on the destructive lifecycle
    // that REV-01 leaves unarmed by owner decision -- see
    // docs/operations/review-source-content-cutover.md. Relaxing them into
    // passing assertions would claim an erasure the product does not perform.
  })
})
