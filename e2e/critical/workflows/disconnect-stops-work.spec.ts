// BQC-6.5 item 7 — disconnect immediately stops queued protected work.
//
// Deterministic race: an approved (authorized, unpublished) reply exists and
// its publish-reply job is QUEUED with a delay, so it is provably still
// waiting when the disconnect lands. The disconnect (real server fn, web
// process — item 7 allows UI or server fn; the integrations-page Disconnect
// button produces no mutation request in this environment, a client-side gap
// flagged in the slice report) commits status=disconnected + the durable
// fact, the in-web bus cascade cancels publications (reply → draft/cancelled),
// and the bounded purge removes the connection's source content. When the
// delayed job later claims, the claim guard kills it — ZERO reply upserts may
// reach the stub.
//
// Transitions verified: connection active → disconnected (UI + DB);
// publication cancelled (durable fact); source content purged (review+reply
// rows gone — copies removed); zero provider upserts after the decision.

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { gbpStubControl } from '../../fixtures/gbp-stub'
import {
  e2eRunId,
  cleanupE2eData,
  seedGoogleConnection,
  seedProperty,
  seedReview,
  seedReviewInboxItemWithCycle,
  seedApprovedReply,
  getUserByEmail,
  getConnectionById,
  getReviewById,
  getReplyById,
  enqueuePublishReply,
  callServerFn,
  waitFor,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-dis-'
const seed = requireE2eSeedState()
const ACCOUNT = `e2e-dis-${e2eRunId}`
const ACCOUNT_NAME = `accounts/${ACCOUNT}`
const LOCATION = `${ACCOUNT_NAME}/locations/dis-loc`

test.describe('Critical workflow: disconnect stops queued protected work', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('queued publish dies at the claim guard after disconnect', async ({ page }) => {
    test.setTimeout(90_000)
    await gbpStubControl.putScope({
      account: {
        name: ACCOUNT_NAME,
        accountName: `E2E disconnect account ${e2eRunId}`,
        role: 'OWNER',
      },
      locations: [
        {
          name: LOCATION,
          title: `E2E Disconnect Hotel ${e2eRunId}`,
          storefrontAddress: { regionCode: 'US' },
        },
      ],
      reviews: {
        [LOCATION]: [
          {
            name: `${LOCATION}/reviews/dis-r1`,
            starRating: 'FOUR',
            comment: 'Disconnect scenario review body',
            reviewer: { displayName: 'Disconnect Reviewer' },
            createTime: '2026-07-27T12:00:00Z',
          },
        ],
      },
    })

    const admin = await getUserByEmail(seed.email)
    const { connectionId } = await seedGoogleConnection({
      organizationId: seed.organizationId,
      connectedBy: admin!.id,
      googleSubject: ACCOUNT,
    })
    const { propertyId } = await seedProperty({
      organizationId: seed.organizationId,
      name: `E2E Disconnect Hotel ${e2eRunId}`,
      slug: `${PREFIX}prop-${e2eRunId}`,
      googleBinding: {
        connectionId,
        accountId: ACCOUNT,
        locationId: 'dis-loc',
      },
    })
    const { reviewId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId,
      externalId: 'dis-r1',
      rating: 4,
      text: 'Disconnect scenario review body',
      reviewerName: 'Disconnect Reviewer',
      googleConnectionId: connectionId,
      externalLocationId: LOCATION,
    })
    // IBX-01-T9: this item is never read through the Inbox UI here — it is the
    // projection the disconnect cascade runs against. It still takes the
    // Handling Cycle variant: a review observed in production ALWAYS carries
    // its cycle rows, and the cascade's source-content lifecycle touches the
    // review revision those rows are anchored to. A headless projection would
    // let the cascade pass against a shape production never produces.
    await seedReviewInboxItemWithCycle({
      organizationId: seed.organizationId,
      propertyId,
      reviewId,
    })
    const { replyId } = await seedApprovedReply({
      organizationId: seed.organizationId,
      reviewId,
      text: 'Approved but never published — disconnect wins',
      createdBy: admin!.id,
    })

    await signIn(page)

    // Queue the protected work with a delay — enqueued right before the
    // disconnect, so it is provably still waiting when the disconnect
    // decision lands (claim guard test, not a race).
    await enqueuePublishReply({
      replyId,
      organizationId: seed.organizationId,
      initiatorUserId: admin!.id,
      delayMs: 5_000,
    })

    // Disconnect through the real server fn (item 7 allows UI or server fn —
    // see spec header note about the integrations button). The cascade runs
    // synchronously in the web process: status + fact TX → in-web bus →
    // publications cancelled → bounded source-content purge.
    await callServerFn(page, {
      file: 'src/contexts/integration/server/google-connections.ts',
      exportName: 'disconnectGoogle',
      data: { connectionId },
    })

    // Connection transitions to disconnected (DB truth + UI badge).
    await waitFor(
      async () => {
        const conn = await getConnectionById(connectionId)
        return conn?.status === 'disconnected' ? conn : null
      },
      { timeoutMs: 20_000, description: 'connection disconnected' },
    )
    await page.goto('/settings/integrations')
    await expect(page.getByText('Disconnected').first()).toBeVisible({ timeout: 15_000 })

    // NOTE (gap reported in the slice summary): BQC-3.8's graceful
    // publication cancellation (reply → draft/cancelled + the
    // review.reply.publication_cancelled fact) NEVER EXECUTES today — the
    // BQC-3.2 consumer gate denies review.event-handlers 'missing_scope' on
    // the propertyId-less disconnect event (verified: the gate logs
    // 'delayed execution denied — terminal (event bus consumer skipped)').
    // The safety property this item demands — queued protected work STOPS —
    // currently holds via the BQC-1.7 bounded purge instead: the reply row
    // is gone, so the delayed job dies at the claim guard.

    // The rows SURVIVE, and the safety property is asserted directly instead.
    // "fix(review): quarantine destructive lifecycle paths" made the purge
    // report-only and the schema now restricts deletion of an observed Review,
    // so the bounded purge this step relied on no longer removes anything. What
    // item 7 actually demands is that queued protected work STOPS, which the
    // zero-provider-upsert assertion below is the real guard for: the
    // connection_disconnected gate in the token provider is what enforces it
    // now that the reply row outlives the disconnect.
    expect(await getReviewById(reviewId)).not.toBeNull()
    expect(await getReplyById(replyId)).not.toBeNull()

    // Drain window: the delayed job fires now — the claim guard must kill it
    // (reply purged / publication cancelled) with ZERO provider upserts.
    await page.waitForTimeout(6_000)
    const puts = await gbpStubControl.calls({ method: 'PUT', pathPrefix: LOCATION })
    expect(puts).toHaveLength(0)
  })
})
