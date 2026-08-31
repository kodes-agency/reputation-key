// BQC-6.5 item 6 — manual reply draft/edit/approve/publish with success,
// transient failure, terminal rejection, and ambiguous reconciliation.
//
// All four scenarios run the REAL chain: web server fns (synchronous
// lifecycle) → BullMQ publish-reply job in the worker → the real GBP reply
// adapter against the stub's scripted provider modes. Scenario (a) drives the
// reply UX in the inbox detail panel; (b)-(d) use RPC for setup and assert
// durable state + stub-recorded provider calls.
//
// Transitions verified:
//   (a) draft → edit → submit → approve → published (stub records the upsert)
//   (b) approve → transient 500 → retryQueued → BullMQ retry → published
//       (failure recovery with the recovered state asserted)
//   (c) approve → terminal 403 → publish_failed/terminal; retry does NOT heal
//   (d) ambiguous publication + provider shows the reply → retryPublish
//       reconcile-before-retry heals to published with ZERO re-sends

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { gbpStubControl, type StubReview } from '../../fixtures/gbp-stub'
import {
  dbQuery,
  drainFixtureQueue,
  enqueueReviewSync,
  e2eRunId,
  cleanupE2eData,
  seedGoogleConnection,
  seedProperty,
  seedReview,
  seedReviewInboxItemWithCycle,
  seedAmbiguousReply,
  getUserByEmail,
  getReplyForReview,
  callServerFn,
  waitFor,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-rep-'
const seed = requireE2eSeedState()
const ACCOUNT = `e2e-rep-${e2eRunId}`
const ACCOUNT_NAME = `accounts/${ACCOUNT}`
// Run-scoped: this spec's Property survives cleanup (its Reply is named by an
// immutable reply_publication_authorization), so a fixed location id would
// collide with the surviving row on properties_org_gbp_location_id_unique.
const locationId = (name: string) => `${name}-loc-${e2eRunId}`

const REPLY_FILE = 'src/contexts/review/server/reply-draft.ts'
const REPLY_FILE_OPS = 'src/contexts/review/server/reply.ts'

type Scenario = Readonly<{
  connectionId: string
  propertyId: string
  reviewId: string
  inboxItemId: string
  locationName: string
  reviewName: string
}>

test.describe('Critical workflow: reply lifecycle', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async () => {
    // Stale provider syncs from an earlier spec retry against a stub scope that
    // has moved on, and burn the shared reviews quota this one needs.
    await drainFixtureQueue()
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  /** Isolated provider + data landscape for one scenario. */
  async function setupScenario(
    name: string,
    opts: {
      reviews: StubReview[]
      replyBehavior?: Parameters<typeof gbpStubControl.putScope>[0]['replyBehavior']
    },
  ): Promise<Scenario> {
    const locationName = `${ACCOUNT_NAME}/locations/${locationId(name)}`
    const reviewName = `${locationName}/reviews/${name}-r1-${e2eRunId}`
    await gbpStubControl.putScope({
      account: {
        name: ACCOUNT_NAME,
        accountName: `E2E reply account ${e2eRunId}`,
        role: 'OWNER',
      },
      locations: [
        {
          name: locationName,
          title: `E2E Reply Hotel ${name} ${e2eRunId}`,
          storefrontAddress: { regionCode: 'US' },
        },
      ],
      reviews: { [locationName]: opts.reviews },
      replyBehavior: opts.replyBehavior,
    })
    const admin = await getUserByEmail(seed.email)
    const { connectionId } = await seedGoogleConnection({
      organizationId: seed.organizationId,
      connectedBy: admin!.id,
      googleSubject: ACCOUNT,
    })
    const { propertyId } = await seedProperty({
      organizationId: seed.organizationId,
      name: `E2E Reply Hotel ${name} ${e2eRunId}`,
      slug: `${PREFIX}${name}-${e2eRunId}`,
      googleBinding: {
        connectionId,
        accountId: ACCOUNT,
        locationId: locationId(name),
      },
    })
    const { reviewId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId,
      externalId: `${name}-r1-${e2eRunId}`,
      rating: 5,
      text: `Reply scenario ${name} review body`,
      reviewerName: `Reply Reviewer ${name}`,
      googleConnectionId: connectionId,
      externalLocationId: locationName,
    })
    // IBX-01-T9: the Handling Cycle variant. Scenario (a) drives the reply UX
    // from `/inbox?itemId=`, and every serving read resolves status from the
    // cycle head — a bare `inbox_items` row would render an empty detail panel.
    // (b)-(d) drive the same scenario through RPC, so they take the same
    // realistic projection rather than a shape production never produces.
    const { inboxItemId } = await seedReviewInboxItemWithCycle({
      organizationId: seed.organizationId,
      propertyId,
      reviewId,
    })
    return { connectionId, propertyId, reviewId, inboxItemId, locationName, reviewName }
  }

  const stubReview = (name: string): StubReview => ({
    name: `${ACCOUNT_NAME}/locations/${locationId(name)}/reviews/${name}-r1-${e2eRunId}`,
    starRating: 'FIVE',
    comment: `Reply scenario ${name} review body`,
    reviewer: { displayName: `Reply Reviewer ${name}` },
    createTime: '2026-07-27T12:00:00Z',
  })

  test('(a) draft → edit → submit → approve → published (UI-driven)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const s = await setupScenario('happy', { reviews: [stubReview('happy')] })
    await signIn(page)
    await page.goto(`/inbox?itemId=${s.inboxItemId}`)
    await expect(page.getByText('Reply Reviewer happy').first()).toBeVisible({
      timeout: 15_000,
    })

    // Draft. There is no Save button: the composer AUTOSAVES, so the draft is
    // proven by the row appearing, not by a click.
    await page.getByPlaceholder('Write a reply…').fill('First draft wording')
    await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'draft' ? reply : null
      },
      { timeoutMs: 15_000, description: 'reply draft autosaved' },
    )

    // Edit the draft — same autosave path.
    await page.getByPlaceholder('Write a reply…').fill('Final reply wording — thank you!')
    await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.text === 'Final reply wording — thank you!' ? reply : null
      },
      { timeoutMs: 15_000, description: 'edited draft autosaved' },
    )

    // Submit for approval.
    await page.getByRole('button', { name: 'Submit for approval' }).click()
    await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'pending_approval' ? reply : null
      },
      { timeoutMs: 10_000, description: 'reply pending approval' },
    )
    await expect(page.getByText('Awaiting Approval').first()).toBeVisible()

    // Approve → the publish job runs (worker) → published.
    // Approval is a two-step confirmation now: the trigger opens a dialog that
    // states what publishing does, and the dialog's own action is what commits.
    await page.getByRole('button', { name: 'Confirm & Publish', exact: true }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Confirm & Publish', exact: true })
      .click()
    // Publication is TWO-PHASE. The publish job writes to Google and stops at
    // "write accepted; awaiting provider observation" -- the attempt sits at
    // provider_outcome_pending until a later read of the review sees the reply
    // and records the observation that confirms it. `review.reply.observed` is
    // the sole provider-reply authority; the write alone never claims success.
    // In production the scheduled sync does that read; here the spec asks for
    // it, rather than waiting on a schedule.
    // Waited on the ATTEMPT, not the reply status: the reply is already
    // 'approved' before the publish job runs, so waiting on that would race the
    // write and the read-back below would find nothing to observe.
    await waitFor(
      async () => {
        const [attempt] = await dbQuery<{ outcome: string }>(
          `SELECT outcome FROM reply_publication_attempts
           WHERE review_id = $1 ORDER BY attempt_number DESC LIMIT 1`,
          [s.reviewId],
        )
        return attempt && attempt.outcome !== 'sending' ? attempt : null
      },
      { timeoutMs: 25_000, description: 'provider write accepted' },
    )
    // Production confirms the write by READING the provider back on the sync
    // schedule, so the test drives that same poll rather than waiting on a
    // scheduler tuned for hours. ONE sync, deliberately: each additional
    // snapshot records another observation, and a newer observation head
    // makes the confirming one non-current — the Inbox close permit is
    // scoped to the exact current observation, so an over-eager poll races
    // the auto-close out of existence.
    await enqueueReviewSync({
      propertyId: s.propertyId,
      organizationId: seed.organizationId,
      connectionId: s.connectionId,
      locationName: s.locationName,
    })
    await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'published' ? reply : null
      },
      { timeoutMs: 60_000, description: 'reply confirmed published by observation' },
    )
    // The published badge, rendered from persisted state. Publishing
    // auto-closes the inbox item (inbox's reply-published handler), so the
    // detail opens from the Closed folder.
    // The auto-close is a SEPARATE durable consumer of the observation fact,
    // so it lands after the reply reports published — wait for it rather than
    // racing the Closed folder.
    await waitFor(
      async () => {
        const [item] = await dbQuery<{ status: string }>(
          `SELECT status FROM inbox_items WHERE id = $1::uuid`,
          [s.inboxItemId],
        )
        return item?.status === 'closed' ? item : null
      },
      { timeoutMs: 30_000, description: 'inbox item auto-closed by the observation' },
    )
    await page.goto(
      `/inbox?folder=closed&propertyId=${s.propertyId}&itemId=${s.inboxItemId}`,
    )
    // The badge names the PROVIDER-confirmed state, not the internal status:
    // 'published' here means Google's own read-back showed the reply.
    await expect(page.getByText('Confirmed on Google').first()).toBeVisible({
      timeout: 15_000,
    })

    // The provider recorded exactly one reply upsert with the final wording.
    const puts = await gbpStubControl.calls({
      method: 'PUT',
      pathPrefix: `/v4/${s.locationName}`,
    })
    expect(puts).toHaveLength(1)
    expect(puts[0].path).toContain(`/reviews/happy-r1-${e2eRunId}/reply`)
    expect(puts[0].body).toContain('Final reply wording — thank you!')
  })

  test('(b) transient 500 heals through the retryQueued path (failure recovery)', async ({
    page,
  }) => {
    // The longest chain in this file: a scripted 500, a BullMQ retry with its
    // backoff, an accepted write, a provider read-back, and the observation
    // that confirms it — every provider step sharing ONE quota with the whole
    // suite. 90s was enough for the spec alone and not for its position in a
    // full run.
    test.setTimeout(180_000)
    const s = await setupScenario('transient', {
      reviews: [stubReview('transient')],
      replyBehavior: { mode: 'fail-then-success', status: 500, failures: 1 },
    })
    await signIn(page)

    // Drive the lifecycle to approved via the synchronous server fns.
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'draftReplyFn',
      data: { reviewId: s.reviewId, text: 'Transient retry reply text' },
    })
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'submitReplyFn',
      data: { reviewId: s.reviewId },
    })
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'approveReplyFn',
      data: { reviewId: s.reviewId },
    })

    // Attempt 1 hits the scripted 500 → classified retryable →
    // markPublicationRetryQueued + BullMQ retry → attempt 2 succeeds. This is
    // the taxonomy's transient failure-recovery path; the recovered state is
    // asserted (published, not merely "a retry was attempted").
    //
    // 'published' is the PROVIDER-confirmed state, so the retry only reaches
    // it once a read-back observes the reply. Wait for the accepted write,
    // then drive that read the way the sync schedule would.
    await waitFor(
      async () => {
        const [attempt] = await dbQuery<{ outcome: string }>(
          `SELECT outcome FROM reply_publication_attempts
           WHERE review_id = $1 ORDER BY attempt_number DESC LIMIT 1`,
          [s.reviewId],
        )
        return attempt && attempt.outcome !== 'sending' ? attempt : null
      },
      { timeoutMs: 30_000, description: 'retried provider write accepted' },
    )
    await enqueueReviewSync({
      propertyId: s.propertyId,
      organizationId: seed.organizationId,
      connectionId: s.connectionId,
      locationName: s.locationName,
    })
    const healed = await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'published' ? reply : null
      },
      {
        // Worker-polling wait: inherit the 90s default instead of the 45s that
        // timed out on a loaded runner (179 probes, no terminal state).
        description: 'reply published after the transient retry',
        diagnose: async () => await getReplyForReview(s.reviewId),
      },
    )
    expect(healed.publication_state).toBe('published')
    expect(healed.publication_attempts).toBe(2)

    // Exactly 2 provider upserts: one transient failure + one recovered success.
    const puts = await gbpStubControl.calls({
      method: 'PUT',
      pathPrefix: `/v4/${s.locationName}`,
    })
    expect(puts).toHaveLength(2)

    // NOTE (gap reported in the slice summary): when ALL BullMQ attempts are
    // exhausted by transient failures the reply sits at status 'approved' /
    // publication_state 'authorized', and retryPublish cannot recover it —
    // the transition authority rejects approved→approved (verified:
    // 'Cannot transition reply from approved to approved'). The only
    // recovery left is the ops quarantine redrive. Operator retryPublish IS
    // covered for the states it supports: terminal (c) and ambiguous (d).
  })

  test('(c) terminal 403 → publish_failed; retry does NOT heal', async ({ page }) => {
    test.setTimeout(90_000)
    const s = await setupScenario('terminal', {
      reviews: [stubReview('terminal')],
      replyBehavior: { mode: 'always-fail', status: 403 },
    })
    await signIn(page)

    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'draftReplyFn',
      data: { reviewId: s.reviewId, text: 'Terminal rejection reply text' },
    })
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'submitReplyFn',
      data: { reviewId: s.reviewId },
    })
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'approveReplyFn',
      data: { reviewId: s.reviewId },
    })

    // Terminal 4xx: one attempt, marked publish_failed/terminal, NO retry burn.
    await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'publish_failed' &&
          reply?.publication_state === 'terminal'
          ? reply
          : null
      },
      {
        // 90s + diagnose, matching google-import-sync.spec.ts: this polls a
        // real background worker on a runner already hosting nine containers,
        // so the deadline only bounds how long the worker may take — the
        // assertions below are what prove the behaviour. At the old 30s this
        // timed out on a loaded runner (119 probes, no terminal state) and
        // passed on a rerun of the same commit.
        timeoutMs: 90_000,
        description: 'reply terminally publish_failed',
        diagnose: async () => await getReplyForReview(s.reviewId),
      },
    )
    const putsAfterTerminal = await gbpStubControl.calls({
      method: 'PUT',
      pathPrefix: `/v4/${s.locationName}`,
    })
    expect(putsAfterTerminal).toHaveLength(1)

    // The UI shows the terminal state.
    await page.goto(`/inbox?propertyId=${s.propertyId}&itemId=${s.inboxItemId}`)
    // The UI names the user-facing state, not the internal status value.
    await expect(page.getByText('Needs a check').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page
        .getByText('Google has not confirmed this reply yet.', { exact: false })
        .first(),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check and retry' })).toBeVisible()

    // Retry is offered but does NOT heal against a still-403 provider — the
    // terminal state persists (no retry-affordance success).
    await callServerFn(page, {
      file: REPLY_FILE_OPS,
      exportName: 'retryPublishFn',
      data: { reviewId: s.reviewId },
    })
    await waitFor(
      async () => {
        const puts = await gbpStubControl.calls({
          method: 'PUT',
          pathPrefix: `/v4/${s.locationName}`,
        })
        return puts.length === 2 ? puts : null
      },
      { timeoutMs: 30_000, description: 'retry re-attempted the provider once' },
    )
    await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'publish_failed' &&
          reply?.publication_state === 'terminal'
          ? reply
          : null
      },
      { timeoutMs: 15_000, description: 'reply stays terminally failed after retry' },
    )
  })

  test('(d) ambiguous + provider shows the reply → reconcile heals without resend', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    // The provider copy carries the reply (the ambiguous send DID land).
    const landed = stubReview('ambig')
    const s = await setupScenario('ambig', {
      reviews: [
        {
          ...landed,
          reviewReply: {
            comment: 'The ambiguous send actually landed',
            updateTime: '2026-07-28T08:00:00Z',
          },
        },
      ],
    })
    const admin = await getUserByEmail(seed.email)
    await seedAmbiguousReply({
      organizationId: seed.organizationId,
      reviewId: s.reviewId,
      text: 'The ambiguous send actually landed',
      createdBy: admin!.id,
    })
    await signIn(page)

    // retryPublish runs reconcile-before-retry INLINE (worker-free): the
    // provider shows the reply → heal to published, no re-enqueue, no resend.
    //
    // The reads share ONE provider quota with the whole suite, so a run that
    // follows a read-heavy spec can be admission-denied here. That is a
    // transient the operator answers by clicking again, and the assertion
    // below is about the reconcile outcome — not about winning the quota on
    // the first try.
    await waitFor(
      async () => {
        try {
          await callServerFn(page, {
            file: REPLY_FILE_OPS,
            exportName: 'retryPublishFn',
            data: { reviewId: s.reviewId },
          })
          return true
        } catch (error) {
          if (!/re-read provider reply state/i.test(String(error))) throw error
          return null
        }
      },
      { timeoutMs: 30_000, description: 'retryPublish admitted by the provider quota' },
    )
    const healed = await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'published' ? reply : null
      },
      {
        timeoutMs: 20_000,
        description: 'ambiguous reply healed to published by reconcile',
      },
    )
    expect(healed.publication_state).toBe('published')

    // Reconciliation is read-only at the provider: ZERO reply upserts.
    const puts = await gbpStubControl.calls({
      method: 'PUT',
      pathPrefix: `/v4/${s.locationName}`,
    })
    expect(puts).toHaveLength(0)
    // …and it did re-read provider state through the real adapter.
    const gets = await gbpStubControl.calls({
      method: 'GET',
      pathPrefix: `/v4/${s.locationName}/reviews`,
    })
    expect(gets.length).toBeGreaterThan(0)
  })
})
