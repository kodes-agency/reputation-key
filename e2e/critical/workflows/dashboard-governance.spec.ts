// BQC-6.5 item 9 — a scoped login's dashboard: governed property data only,
// no cross-property data, no raw-expired data, and reply-derived fields
// redacted for a reader who may not manage replies (with an admin control).
//
// Verified at the governed read boundary, getDashboardDataFn. The dashboard UI
// reads getPropertyOverviewFn instead; getDashboardDataFn is kept for this spec
// and review-expiry.spec.ts (src/contexts/reporting/CONTEXT.md).
//
// The scoped login is a PropertyManager with one grant. From 2026-08-30 to
// 2026-10-13 the whole scoped test was skipped because it signed in as a
// Member, and Member login is dark. Scoping and expiry never depended on that
// role and run again as a manager. The redaction does depend on it: both
// interactive roles of the beta may manage replies, so no session can ask for
// the redacted read, and that one case stays parked. The rule itself is held by
// get-dashboard-data.test.ts ("hides reply state from a reader who may not
// manage replies").
//
// Landscape: a dedicated property A (the scoped login has an operator grant to
// it) carries a fresh 5★ review with a published reply + an expired 1★ review;
// property B (no grant) carries a fresh 1★ review with distinctive content.

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import {
  e2eRunId,
  cleanupE2eData,
  seedProperty,
  seedReview,
  seedPublishedReply,
  seedMemberUserWithGrant,
  callServerFnGet,
  callServerFnGetExpectError,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-gov-'
const BASE_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const seed = requireE2eSeedState()
const DASHBOARD_FILE = 'src/contexts/reporting/server/dashboard.ts'

type DashboardResult = Readonly<{
  kpis: { avgRating: { value: number }; reviews: { value: number } }
  replyPerformance: { replyRate: number; avgReplyHours: number | null }
  recentReviews: ReadonlyArray<{ id: string; replyStatus: string }>
}>

test.describe('Critical workflow: dashboard governance (scoped login vs admin)', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  /** A: fresh 5★ (+published reply) + expired 1★; B: fresh 1★ distinctive.
   * A is DEDICATED to this spec (aggregate assertions demand isolation from
   * other specs sharing the seeded property). */
  async function seedLandscape() {
    const { propertyId: propertyAId } = await seedProperty({
      organizationId: seed.organizationId,
      name: `E2E Gov Hotel A ${e2eRunId}`,
      slug: `${PREFIX}a-${e2eRunId}`,
    })
    const { reviewId: freshAId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId: propertyAId,
      externalId: `${PREFIX}a-fresh-${e2eRunId}`,
      rating: 5,
      text: 'Governed fresh review on property A.',
      reviewerName: 'Governed A Reviewer',
    })
    await seedPublishedReply({
      organizationId: seed.organizationId,
      reviewId: freshAId,
      text: 'Published reply on property A',
    })
    const { reviewId: expiredAId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId: propertyAId,
      externalId: `${PREFIX}a-expired-${e2eRunId}`,
      rating: 1,
      text: 'Expired review on property A — excluded from aggregates.',
      reviewerName: 'Expired A Reviewer',
      contentExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
    })
    const { propertyId: propertyBId } = await seedProperty({
      organizationId: seed.organizationId,
      name: `E2E Governance Other Hotel ${e2eRunId}`,
      slug: `${PREFIX}b-${e2eRunId}`,
    })
    await seedReview({
      organizationId: seed.organizationId,
      propertyId: propertyBId,
      externalId: `${PREFIX}b-fresh-${e2eRunId}`,
      rating: 1,
      text: 'Cross-property review on B — Member must never see this.',
      reviewerName: 'Cross Property B Reviewer',
    })
    return { propertyAId, freshAId, expiredAId, propertyBId }
  }

  test('a PropertyManager reads the granted property dashboard without expired reviews, and no other property', async ({
    browser,
  }) => {
    const { propertyAId, freshAId, expiredAId, propertyBId } = await seedLandscape()
    // role 'admin' = PropertyManager: a membership and this one grant.
    const manager = await seedMemberUserWithGrant({
      organizationId: seed.organizationId,
      propertyId: propertyAId,
      email: `${PREFIX}manager-${e2eRunId}@example.com`,
      name: 'E2E Dashboard Manager',
      role: 'admin',
    })

    // The manager's own session, in its own context, as the other specs that
    // sign a grant-only manager in do (inbox-property-manager, member-access).
    const context = await browser.newContext({ baseURL: BASE_ORIGIN })
    try {
      const page = await context.newPage()
      await signIn(page, manager.email, manager.password, BASE_ORIGIN)

      // The grant-filtered enumeration contains no B — no surface of this
      // manager can render B's content.
      const listed = await callServerFnGet<{
        properties: ReadonlyArray<{ id: string }>
      }>(page, {
        file: 'src/contexts/property/server/property-read.ts',
        exportName: 'listProperties',
      })
      expect(listed.properties.map((p) => p.id)).toContain(propertyAId)
      expect(listed.properties.map((p) => p.id)).not.toContain(propertyBId)

      // A's dashboard: governed aggregates. The expired 1★ is excluded (avg 5
      // over 1 review, not 3 over 2).
      const dashboard = await callServerFnGet<DashboardResult>(page, {
        file: DASHBOARD_FILE,
        exportName: 'getDashboardDataFn',
        data: { propertyId: propertyAId, timeRange: 'all' },
      })
      expect(dashboard.kpis.avgRating.value).toBe(5)
      expect(dashboard.kpis.reviews.value).toBe(1)
      expect(dashboard.recentReviews.map((r) => r.id)).not.toContain(expiredAId)
      // A manager may manage replies, so reply state is not hidden from them.
      expect(dashboard.recentReviews.find((r) => r.id === freshAId)?.replyStatus).toBe(
        'published',
      )

      // B's dashboard: refused by the policy (no grant), as a 403.
      const denial = await callServerFnGetExpectError(page, {
        file: DASHBOARD_FILE,
        exportName: 'getDashboardDataFn',
        data: { propertyId: propertyBId, timeRange: 'all' },
      })
      expect(denial.status).toBe(403)
    } finally {
      await context.close()
    }
  })

  // SKIPPED: reply state redacted for a reader who may not manage replies. It
  // needs a login without reply.manage. The beta has none: AccountAdmin and
  // PropertyManager both hold it, and Member login is dark
  // (isBetaInteractiveRole), so this sign-in fails before any assertion. The
  // rule is held below e2e (see the header); this case returns with a role
  // that signs in without reply.manage. Registered, with a review-by date, in
  // scripts/check-test-quality.mjs.
  test.skip('a login that may not manage replies sees reply state redacted', async ({
    page,
  }) => {
    const { propertyAId } = await seedLandscape()
    const member = await seedMemberUserWithGrant({
      organizationId: seed.organizationId,
      propertyId: propertyAId,
      email: `${PREFIX}member-${e2eRunId}@example.com`,
      name: 'E2E Dashboard Member',
    })
    await signIn(page, member.email, member.password, undefined, '/settings/profile')
    await expect(page.getByRole('heading', { name: /profile/i }).first()).toBeVisible({
      timeout: 15_000,
    })

    const memberDashboard = await callServerFnGet<DashboardResult>(page, {
      file: DASHBOARD_FILE,
      exportName: 'getDashboardDataFn',
      data: { propertyId: propertyAId, timeRange: 'all' },
    })
    // Reply-derived fields are redacted (no reply.manage): zeroed performance
    // and hidden per-review state.
    expect(memberDashboard.replyPerformance).toEqual({
      replyRate: 0,
      avgReplyHours: null,
    })
    for (const review of memberDashboard.recentReviews) {
      expect(review.replyStatus).toBe('none')
    }
  })

  test('admin control sees the reply data a reader without reply.manage would not', async ({
    page,
  }) => {
    const { propertyAId, freshAId } = await seedLandscape()
    await signIn(page)
    const adminDashboard = await callServerFnGet<DashboardResult>(page, {
      file: DASHBOARD_FILE,
      exportName: 'getDashboardDataFn',
      data: { propertyId: propertyAId, timeRange: 'all' },
    })
    expect(adminDashboard.kpis.avgRating.value).toBe(5)
    expect(adminDashboard.replyPerformance.replyRate).toBeGreaterThan(0)
    expect(adminDashboard.recentReviews.find((r) => r.id === freshAId)?.replyStatus).toBe(
      'published',
    )
  })
})
