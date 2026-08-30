// BQC-6.5 item 9 — limited (staff) dashboard: governed property data only,
// no cross-property data, no raw-expired data, and reply-derived fields
// redacted for roles lacking reply.manage (with an admin control).
//
// Verified at the governed read boundary — getDashboardDataFn IS the read the
// dashboard UI consumes; staff UI surfaces are manager-gated today
// (/properties/* and /home), so the staff-side assertions target the access
// model directly (grant-filtered enumeration + governed aggregates +
// role-based reply redaction), with an admin control for the redaction.
//
// Landscape: a dedicated property A (staff has an operator grant to it)
// carries a fresh 5★ review with a published reply + an expired 1★ review;
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
  seedStaffUserWithGrant,
  callServerFnGet,
  callServerFnGetExpectError,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-gov-'
const seed = requireE2eSeedState()
const DASHBOARD_FILE = 'src/contexts/dashboard/server/dashboard.ts'

type DashboardResult = Readonly<{
  kpis: { avgRating: { value: number }; reviews: { value: number } }
  replyPerformance: { replyRate: number; avgReplyHours: number | null }
  recentReviews: ReadonlyArray<{ id: string; replyStatus: string }>
}>

test.describe('Critical workflow: dashboard governance (staff vs admin)', () => {
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
      text: 'Cross-property review on B — staff must never see this.',
      reviewerName: 'Cross Property B Reviewer',
    })
    return { propertyAId, freshAId, expiredAId, propertyBId }
  }

  // SKIPPED: exercises Staff User login, which this beta deliberately does not
  // have. 52635b32 made only owner/admin tokens beta-interactive
  // (isBetaInteractiveMemberRoleToken), so a Staff member cannot resolve tenant
  // context at all — the sign-in fails before any dashboard assertion runs.
  // "Staff User login" is on the program's dark-capability list, so the fence is
  // the intended behaviour and this test is asserting a capability that is off.
  // Re-enable with the capability, not before; the staff-scoping coverage it
  // provides is real and should come back when Staff can log in.
  test.skip('staff dashboard is governed, scoped, expiry-clean, and reply-redacted', async ({
    page,
  }) => {
    const { propertyAId, expiredAId, propertyBId } = await seedLandscape()
    const staff = await seedStaffUserWithGrant({
      organizationId: seed.organizationId,
      propertyId: propertyAId,
      email: `${PREFIX}staff-${e2eRunId}@example.com`,
      name: 'E2E Dashboard Staff',
    })
    // Staff session reaches the authenticated area cleanly. The governed-data
    // assertions below run against the SAME server fn the dashboard UI is fed
    // by — staff UI surfaces are manager-gated today (see spec header).
    await signIn(page, staff.email, staff.password, undefined, '/settings/profile')
    await expect(page.getByRole('heading', { name: /profile/i }).first()).toBeVisible({
      timeout: 15_000,
    })

    // The grant-filtered enumeration contains no B — no staff surface can
    // ever render B's content.
    const listed = await callServerFnGet<{ properties: ReadonlyArray<{ id: string }> }>(
      page,
      {
        file: 'src/contexts/property/server/property-read.ts',
        exportName: 'listProperties',
      },
    )
    expect(listed.properties.map((p) => p.id)).not.toContain(propertyBId)

    // Staff → A's dashboard: governed aggregates. The expired 1★ is excluded
    // (avg 5 over 1 review, not 3 over 2).
    const staffDashboard = await callServerFnGet<DashboardResult>(page, {
      file: DASHBOARD_FILE,
      exportName: 'getDashboardDataFn',
      data: { propertyId: propertyAId, timeRange: 'all' },
    })
    expect(staffDashboard.kpis.avgRating.value).toBe(5)
    expect(staffDashboard.kpis.reviews.value).toBe(1)
    expect(staffDashboard.recentReviews.map((r) => r.id)).not.toContain(expiredAId)
    // Reply-derived fields are redacted for staff (no reply.manage): zeroed
    // performance + hidden per-review state…
    expect(staffDashboard.replyPerformance).toEqual({ replyRate: 0, avgReplyHours: null })
    for (const review of staffDashboard.recentReviews) {
      expect(review.replyStatus).toBe('none')
    }

    // Staff → B's dashboard: denied (no grant).
    const denial = await callServerFnGetExpectError(page, {
      file: DASHBOARD_FILE,
      exportName: 'getDashboardDataFn',
      data: { propertyId: propertyBId, timeRange: 'all' },
    })
    expect(denial.message ?? '').toMatch(/error|denied/i)
  })

  test('admin control sees the reply data the staff surface redacts', async ({
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
