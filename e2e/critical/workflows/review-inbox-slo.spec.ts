// BQC-6.5 item 4 — review arrival → durable inbox projection within the SLO.
//
// SLO DEFINITION (flagged for the manifest): the repo has NO existing SLO
// definition for this path — this test DEFINES it as: the content-free inbox
// projection for a newly arrived review is durably visible within 10 seconds
// of the arrival trigger (sync enqueue). Measured from enqueue to the
// projection row being readable; the whole chain (worker claim → stub fetch
// → upsert + review.created in one TX → in-worker bus → inbox projection)
// runs for real.
//
// Transitions verified: sync lands the review; its inbox projection appears
// ≤ 10s, is LINKED (source_id = review id), is content-free at rest (the
// projection row carries no rating/snippet/reviewer copies — those are
// resolved live at read time), and renders in the inbox UI.

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { gbpStubControl } from '../../fixtures/gbp-stub'
import {
  e2eRunId,
  cleanupE2eData,
  seedGoogleConnection,
  seedProperty,
  getUserByEmail,
  dbQuery,
  getInboxItemForReview,
  enqueueReviewSync,
  waitFor,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-slo-'
const seed = requireE2eSeedState()
const ACCOUNT = `e2e-slo-${e2eRunId}`
const ACCOUNT_NAME = `accounts/${ACCOUNT}`
const LOCATION = `${ACCOUNT_NAME}/locations/slo-loc`

/** Defined here (see header): projection visible ≤ 10s of arrival. */
const INBOX_PROJECTION_SLO_MS = 10_000

test.describe('Critical workflow: review arrival → inbox projection SLO', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('new review projects to the inbox within the defined SLO', async ({ page }) => {
    await gbpStubControl.putScope({
      account: {
        name: ACCOUNT_NAME,
        type: 'LOCATION_GROUP',
        roleInfo: { name: 'OWNER' },
      },
      locations: [
        {
          name: LOCATION,
          title: `E2E SLO Hotel ${e2eRunId}`,
          storefrontAddress: { regionCode: 'US' },
        },
      ],
      reviews: {
        [LOCATION]: [
          {
            name: `${LOCATION}/reviews/slo-r1`,
            starRating: 'FIVE',
            comment: 'SLO arrival review body',
            reviewer: { displayName: 'SLO Arrival Reviewer' },
            createTime: '2026-07-28T09:00:00Z',
          },
        ],
      },
    })

    const admin = await getUserByEmail(seed.email)
    const { connectionId } = await seedGoogleConnection({
      organizationId: seed.organizationId,
      connectedBy: admin!.id,
      googleAccountId: ACCOUNT,
    })
    const { propertyId } = await seedProperty({
      organizationId: seed.organizationId,
      name: `E2E SLO Hotel ${e2eRunId}`,
      slug: `${PREFIX}prop-${e2eRunId}`,
      gbpPlaceId: 'slo-loc',
      googleConnectionId: connectionId,
    })

    await signIn(page)

    // t0 = arrival trigger (the sync enqueue — what the webhook/import paths
    // would do; measured from here to projection visibility).
    await enqueueReviewSync({
      propertyId,
      organizationId: seed.organizationId,
      connectionId,
      locationName: LOCATION,
    })

    const projection = await waitFor(
      async () => {
        const reviews = await dbQuery<{ id: string }>(
          'SELECT id FROM reviews WHERE organization_id = $1 AND external_id = $2',
          [seed.organizationId, 'slo-r1'],
        )
        if (!reviews[0]) return null
        return getInboxItemForReview(reviews[0].id)
      },
      {
        timeoutMs: INBOX_PROJECTION_SLO_MS,
        intervalMs: 200,
        description: `inbox projection within ${INBOX_PROJECTION_SLO_MS}ms of arrival`,
      },
    )

    // Linked + content-free at rest: the projection row carries no source
    // content copies (BQC-1.2 — rating/snippet/reviewer resolve live).
    const review = (
      await dbQuery<{ id: string }>(
        'SELECT id FROM reviews WHERE organization_id = $1 AND external_id = $2',
        [seed.organizationId, 'slo-r1'],
      )
    )[0]!
    expect(projection.source_id).toBe(review.id)
    expect(String(projection.property_id)).toBe(propertyId)
    expect(projection.snippet).toBeNull()
    expect(projection.rating).toBeNull()
    expect(projection.reviewer_name).toBeNull()
    expect(projection.status).toBe('open')

    // The projection renders in the inbox UI (live eligible lookup supplies
    // reviewer/rating at read time).
    await page.goto(`/inbox?itemId=${projection.id}`)
    await expect(page.getByText('SLO Arrival Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
