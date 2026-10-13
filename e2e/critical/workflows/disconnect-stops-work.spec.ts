// BQC-6.5 item 7 — a disconnect stops reply publication that is already queued.
//
// Two reviews of one Google location arrive through the real sync, and each
// gets a reply through the real commands (draft, submit, Confirm & Publish):
//
//   control  approved while the connection is active. The worker publishes it,
//            and the provider stub records one reply PUT for the location.
//   held     approved with the `default` queue paused, so its `publish-reply`
//            job (the one production enqueued) is on the queue and unstarted
//            when the disconnect lands.
//
// The disconnect is the real server function. It commits the connection as
// disconnected with its durable fact; Review's consumer of that fact cancels
// every publication of the connection that was never dispatched, which returns
// the held reply to draft. The queue is then resumed, the worker takes the held
// job, finds a reply that is no longer approved, and stops.
//
// What makes the last assertion able to fail: the provider calls are read with
// the same filter before and after. Before the disconnect it must see the
// control's PUT, so the filter matches this location's reply writes and the
// seeded connection, Property and reviews do publish. After the held job has
// run it must still see exactly that one. A reply sent after the disconnect is
// a second PUT under the same prefix.

import type { Page } from '@playwright/test'
import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { gbpStubControl, type StubReview } from '../../fixtures/gbp-stub'
import {
  callServerFn,
  cleanupE2eData,
  dbQuery,
  drainFixtureQueue,
  e2eRunId,
  enqueueReviewSync,
  findUnstartedFixtureJob,
  getConnectionById,
  getInboxItemForReview,
  getReplyForReview,
  getUserByEmail,
  pauseFixtureQueue,
  resumeFixtureQueue,
  seedGoogleConnection,
  seedProperty,
  waitFor,
  waitForFixtureJobSettled,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-dis-'
const seed = requireE2eSeedState()
const ACCOUNT = `e2e-dis-${e2eRunId}`
const ACCOUNT_NAME = `accounts/${ACCOUNT}`
// Run-scoped: an approved reply is named by an immutable publication
// authorization, so this Property outlives cleanup and a fixed location id
// would collide with it on the next run.
const LOCATION_ID = `dis-loc-${e2eRunId}`
const LOCATION = `${ACCOUNT_NAME}/locations/${LOCATION_ID}`
const CONTROL_REVIEW = `dis-control-${e2eRunId}`
const HELD_REVIEW = `dis-held-${e2eRunId}`
const CONTROL_TEXT = 'Published while the connection was active'
const HELD_TEXT = 'Approved before the disconnect, never sent'

const PUBLISH_QUEUE = 'default'
const PUBLISH_JOB = 'publish-reply'
const REPLY_FILE = 'src/contexts/review/server/reply-draft.ts'
const CONNECTIONS_FILE = 'src/contexts/integration/server/google-connections.ts'

const stubReview = (externalId: string, body: string): StubReview => ({
  name: `${LOCATION}/reviews/${externalId}`,
  starRating: 'FOUR',
  comment: body,
  reviewer: { displayName: `Disconnect Reviewer ${externalId}` },
  createTime: '2026-07-27T12:00:00Z',
})

/** Every reply write the provider recorded for this spec's location. */
const replyWrites = () =>
  gbpStubControl.calls({ method: 'PUT', pathPrefix: `/v4/${LOCATION}` })

/** Draft, submit and Confirm & Publish a reply through the real commands. */
async function approveReply(page: Page, reviewId: string, text: string): Promise<void> {
  await callServerFn(page, {
    file: REPLY_FILE,
    exportName: 'draftReplyFn',
    data: { reviewId, text },
  })
  await callServerFn(page, {
    file: REPLY_FILE,
    exportName: 'submitReplyFn',
    data: { reviewId },
  })
  await callServerFn(page, {
    file: REPLY_FILE,
    exportName: 'approveReplyFn',
    data: { reviewId },
  })
}

async function arrivedReviewId(propertyId: string, externalId: string): Promise<string> {
  const review = await waitFor(
    async () => {
      const [row] = await dbQuery<{ id: string }>(
        'SELECT id FROM reviews WHERE organization_id = $1 AND property_id = $2::uuid AND external_id = $3',
        [seed.organizationId, propertyId, externalId],
      )
      return row ?? null
    },
    { timeoutMs: 30_000, description: `arrived review ${externalId}` },
  )
  await waitFor(() => getInboxItemForReview(review.id), {
    timeoutMs: 15_000,
    description: `inbox item for arrived review ${externalId}`,
  })
  return review.id
}

async function publicationAttemptCount(reviewId: string): Promise<number> {
  const [row] = await dbQuery<{ attempts: number }>(
    'SELECT count(*)::int AS attempts FROM reply_publication_attempts WHERE review_id = $1::uuid',
    [reviewId],
  )
  return row?.attempts ?? 0
}

test.describe('Critical workflow: disconnect stops queued protected work', () => {
  test.beforeEach(async () => {
    // A run that was killed while it held the queue leaves it paused.
    await resumeFixtureQueue(PUBLISH_QUEUE)
    // A sync left over from an earlier spec would spend the shared reviews
    // quota this one needs for its own.
    await drainFixtureQueue()
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test.afterEach(async () => {
    // The pause is a flag in the queue Redis. A test that stops between the
    // pause and its own resume must not leave every later spec's jobs waiting.
    await resumeFixtureQueue(PUBLISH_QUEUE)
  })

  test('a reply approved before the disconnect is never sent once the connection is disconnected', async ({
    page,
  }) => {
    // Three waits on the real worker (publish, cancellation, the held job),
    // each with the 90s ceiling a loaded runner needs.
    test.setTimeout(300_000)
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
          stubReview(CONTROL_REVIEW, 'Disconnect scenario control review body'),
          stubReview(HELD_REVIEW, 'Disconnect scenario held review body'),
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
        locationId: LOCATION_ID,
      },
    })
    // GBP does not expose a review language. Configure the Property's supported
    // manual-reply language so the imported reviews can be drafted.
    await dbQuery(
      `UPDATE properties
       SET default_reply_language = 'en-Latn', updated_at = now()
       WHERE organization_id = $1 AND id = $2::uuid`,
      [seed.organizationId, propertyId],
    )
    // The reviews arrive through the real sync, so each carries the source
    // revision, observation and Handling Cycle a publication is bound to.
    await enqueueReviewSync({
      propertyId,
      organizationId: seed.organizationId,
      connectionId,
      locationName: LOCATION,
    })
    const controlReviewId = await arrivedReviewId(propertyId, CONTROL_REVIEW)
    const heldReviewId = await arrivedReviewId(propertyId, HELD_REVIEW)

    await signIn(page)

    // ── Control: while connected, an approved reply reaches the provider. ──
    await approveReply(page, controlReviewId, CONTROL_TEXT)
    await waitFor(
      async () => {
        const [attempt] = await dbQuery<{ outcome: string }>(
          `SELECT outcome FROM reply_publication_attempts
           WHERE review_id = $1::uuid ORDER BY attempt_number DESC LIMIT 1`,
          [controlReviewId],
        )
        return attempt && attempt.outcome !== 'sending' ? attempt : null
      },
      {
        description: 'control reply written to the provider',
        diagnose: async () => await getReplyForReview(controlReviewId),
      },
    )
    const writesWhileConnected = await replyWrites()
    expect(writesWhileConnected.map((call) => call.path)).toEqual([
      expect.stringContaining(`/reviews/${CONTROL_REVIEW}/reply`),
    ])
    expect(writesWhileConnected.map((call) => call.body)).toEqual([
      expect.stringContaining(CONTROL_TEXT),
    ])

    // ── Held: approved, its publish job queued and unstarted. ──────────────
    await pauseFixtureQueue(PUBLISH_QUEUE)
    await approveReply(page, heldReviewId, HELD_TEXT)
    const approved = await getReplyForReview(heldReviewId)
    expect(approved).toMatchObject({
      status: 'approved',
      publication_state: 'authorized',
      publication_attempts: 0,
    })
    const heldReplyId = approved!.id as string
    // Approval enqueues the job itself before it returns, so it is already
    // there; the budget covers the durable consumer that enqueues it as well.
    const heldJob = await waitFor(
      () =>
        findUnstartedFixtureJob(
          PUBLISH_QUEUE,
          PUBLISH_JOB,
          (data) => data.replyId === heldReplyId,
        ),
      { timeoutMs: 30_000, description: 'held publish-reply job queued and unstarted' },
    )

    // ── Disconnect, through the real server function. ──────────────────────
    await callServerFn(page, {
      file: CONNECTIONS_FILE,
      exportName: 'disconnectGoogle',
      data: { connectionId },
    })
    await waitFor(
      async () => {
        const conn = await getConnectionById(connectionId)
        return conn?.status === 'disconnected' ? conn : null
      },
      { timeoutMs: 20_000, description: 'connection disconnected' },
    )

    // The disconnect fact's consumer cancels the publication that was never
    // dispatched: the held reply returns to draft with one cancelled cycle.
    await waitFor(
      async () => {
        const reply = await getReplyForReview(heldReviewId)
        return reply?.status === 'draft' && reply?.publication_state === 'cancelled'
          ? reply
          : null
      },
      {
        description: 'held reply publication cancelled by the disconnect',
        diagnose: async () => await getReplyForReview(heldReviewId),
      },
    )

    // ── Release the held job and let the worker settle it. ─────────────────
    await resumeFixtureQueue(PUBLISH_QUEUE)
    await waitForFixtureJobSettled(
      PUBLISH_QUEUE,
      heldJob.jobId,
      'held publish-reply job settled after the disconnect',
    )

    // Nothing was sent for the held reply: the provider still holds exactly
    // the control's write, and the held reply was never claimed.
    const writesAfterDisconnect = await replyWrites()
    expect(writesAfterDisconnect.map((call) => call.path)).toEqual([
      expect.stringContaining(`/reviews/${CONTROL_REVIEW}/reply`),
    ])
    expect(await publicationAttemptCount(heldReviewId)).toBe(0)
    expect(await getReplyForReview(heldReviewId)).toMatchObject({
      status: 'draft',
      publication_state: 'cancelled',
      publication_attempts: 0,
      text: HELD_TEXT,
    })

    // The connection reads as disconnected where a manager looks for it.
    await page.goto('/settings/integrations')
    await expect(page.getByText('Disconnected').first()).toBeVisible({ timeout: 15_000 })
  })
})
