// Notifications and Inbox Handling History keep source review content private.
// A synced review is projected into the Inbox, then closed, reopened and noted.
// Notification payloads and rendered history must exclude source content.

import { test, expect } from '../../helpers/error-detection'
import { clickWhenReady, waitForHydration } from '../../helpers/interaction'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { gbpStubControl } from '../../fixtures/gbp-stub'
import {
  drainFixtureQueue,
  waitForQueuesIdle,
  enqueueReviewSync,
} from '../../helpers/fixture-queues'
import { e2eRunId, dbQuery } from '../../helpers/fixture-db'
import { cleanupE2eData } from '../../helpers/fixture-cleanup'
import {
  seedGoogleConnection,
  seedProperty,
  getUserByEmail,
} from '../../helpers/fixture-seeds'
import {
  getInboxItemForReview,
  getInboxItemById,
  getNotificationsForUser,
} from '../../helpers/fixture-reads'
import { closeInboxItemBySourceAuthority } from '../../helpers/fixture-inbox-seeds'
import { waitFor } from '../../helpers/wait-for'

const PREFIX = 'e2e-not-'
const seed = requireE2eSeedState()
const ACCOUNT = `e2e-not-${e2eRunId}`
const ACCOUNT_NAME = `accounts/${ACCOUNT}`
const LOCATION = `${ACCOUNT_NAME}/locations/not-loc`
const SENSITIVE_TEXT = 'SENSITIVE-REVIEW-TEXT-MARKER never shown'
const SENSITIVE_NAME = 'SENSITIVE-REVIEWER-NAME-MARKER'

test.describe('Critical workflow: content-safe notifications and handling history', () => {
  test.beforeEach(async () => {
    // Stale provider syncs from an earlier spec retry against a stub scope that
    // has moved on, and burn the shared reviews quota this one needs.
    await drainFixtureQueue()
    // And start from a quiescent worker: the SLO is arrival-to-projection
    // latency, not latency while another spec's events are still draining.
    await waitForQueuesIdle()
    await gbpStubControl.reset()
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('facts render without source content at rest and in the UI', async ({ page }) => {
    test.setTimeout(90_000)
    await gbpStubControl.putScope({
      account: {
        name: ACCOUNT_NAME,
        accountName: `E2E notification account ${e2eRunId}`,
        role: 'OWNER',
      },
      locations: [
        {
          name: LOCATION,
          title: `E2E Notify Hotel ${e2eRunId}`,
          storefrontAddress: { regionCode: 'US' },
        },
      ],
      reviews: {
        [LOCATION]: [
          {
            name: `${LOCATION}/reviews/not-r1`,
            starRating: 'TWO',
            comment: SENSITIVE_TEXT,
            reviewer: { displayName: SENSITIVE_NAME },
            createTime: '2026-07-28T09:00:00Z',
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
      name: `E2E Notify Hotel ${e2eRunId}`,
      slug: `${PREFIX}prop-${e2eRunId}`,
      googleBinding: {
        connectionId,
        accountId: ACCOUNT,
        locationId: 'not-loc',
      },
    })
    // The Property has no explicit responsible manager, so the current
    // AccountAdmin is the notification recovery recipient.
    //
    // A new review is an arrival, off in the app by default (ADR 0046, amended
    // 2026-09-30). This spec is about what an arrival notice carries, so the
    // admin turns arrivals on for this Property first, as a person would in
    // their preferences.
    await dbQuery(
      `INSERT INTO notification_preferences
         (user_id, organization_id, property_id, category, channel, enabled, cadence)
       VALUES ($1, $2, $3, 'arrivals', 'in_app', true, 'daily')
       ON CONFLICT (user_id, organization_id, property_id, category, channel)
       DO UPDATE SET enabled = true`,
      [admin!.id, seed.organizationId, propertyId],
    )

    await signIn(page)

    // Real arrival chain: sync → review.created → projection + facts (worker).
    await enqueueReviewSync({
      propertyId,
      organizationId: seed.organizationId,
      connectionId,
      locationName: LOCATION,
    })
    const inboxItem = await waitFor(
      async () => {
        const reviews = await dbQuery<{ id: string }>(
          'SELECT review_id AS id FROM review_source_contents WHERE organization_id = $1 AND external_id = $2',
          [seed.organizationId, 'not-r1'],
        )
        if (!reviews[0]) return null
        return getInboxItemForReview(reviews[0].id)
      },
      { timeoutMs: 15_000, description: 'inbox item for the arrived review' },
    )

    // The new-review notification for the assigned admin — awaited BEFORE the
    // source-authority close below. The notice is written after
    // the item exists, by the consumer, and first asks the Inbox
    // whether the review still waits: a notice for a review already answered
    // is never written (ADR 0046, amended 2026-09-28). Closing first would
    // race that job and, when the close wins, correctly leave no notice.
    const notifications = await waitFor(
      async () => {
        const rows = await getNotificationsForUser(admin!.id)
        const match = rows.filter(
          (r) => r.type === 'review.created' && r.resource_id === inboxItem.id,
        )
        return match.length >= 1 ? match : null
      },
      { timeoutMs: 30_000, description: 'new-review notification for the admin' },
    )
    // Copy is rendered from `type` + `payload` now, so assert the SHAPE the
    // renderer guarantees rather than a frozen sentence: the property name and
    // the star rating are present, and no identifier is.
    expect(notifications[0].title).toContain('review')
    expect(notifications[0].title).not.toContain(inboxItem.id)
    // Two stars is at or below the admin's default Low ratings threshold in
    // the app (3★ or lower), so the review reaches them as a Low ratings
    // notice — read from Review at routing time, kept only as the outcome,
    // and saying so without its stars (ADR 0046, amended 2026-09-30).
    const notice = notifications[0]!
    expect(notice.category).toBe('low_ratings')
    expect(notice.title).toContain('Low-rated review')
    expect(notice.payload).toMatchObject({ lowRating: true })
    expect(JSON.stringify(notice)).not.toMatch(/"(star)?rating"/i)
    expect(notifications[0].body ?? '').not.toContain(inboxItem.id)
    // The point of this test: the allowlisted payload cannot carry source
    // content. `payload` is stringified along with the row, so this now covers
    // the new column too.
    expect(JSON.stringify(notifications[0])).not.toContain('SENSITIVE-REVIEW-TEXT-MARKER')
    expect(JSON.stringify(notifications[0])).not.toContain(
      'SENSITIVE-REVIEWER-NAME-MARKER',
    )

    // Triage actions: close, reopen, note.
    //
    // Closing is an OUTCOME, not a manager toggle — there is deliberately no
    // Close control anywhere in the detail or the bulk toolbar (asserted by
    // inbox-handling-cycle.spec.ts). The source authority closes the cycle;
    // reopening is the manual decision, and it IS in the UI.
    await page.goto(`/inbox?itemId=${inboxItem.id}`)
    await expect(page.getByText(SENSITIVE_NAME).first()).toBeVisible({ timeout: 15_000 })
    await closeInboxItemBySourceAuthority({
      organizationId: seed.organizationId,
      inboxItemId: inboxItem.id as string,
      closeReason: 'external_reply_observed',
    })
    await waitFor(
      async () => {
        const item = await getInboxItemById(inboxItem.id as string)
        return item?.status === 'closed' ? item : null
      },
      { timeoutMs: 10_000, description: 'item closed' },
    )
    // Reopen through the real manager path: work-status select → reason →
    // confirm. A reopen without a stated reason is refused by the dialog.
    await page.goto(`/inbox?queue=replied&itemId=${inboxItem.id}`)
    // Work status is now a case-strip chip BUTTON whose menu offers `Reopen`
    // (role `menuitem`, not `option`) — see inbox-triage.spec.ts.
    await page.getByRole('button', { name: 'Work status' }).click()
    await page.getByRole('menuitem', { name: 'Reopen' }).click()
    await page.getByRole('combobox', { name: 'Reason for reopening' }).click()
    await page.getByRole('option', { name: 'New information', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Reopen', exact: true })
      .click()
    await waitFor(
      async () => {
        const item = await getInboxItemById(inboxItem.id as string)
        return item?.status === 'open' ? item : null
      },
      { timeoutMs: 10_000, description: 'item reopened' },
    )
    await page.goto(`/inbox?itemId=${inboxItem.id}`)
    await expect(page.getByText(SENSITIVE_NAME).first()).toBeVisible({ timeout: 15_000 })
    // Filed from the pinned composer's Note mode. The notes THEMSELVES are
    // messages in the thread now; what sits behind the `Internal note` segment
    // is the write form. The segment kept the `tab` role and this exact name
    // across the composer rebuild (see inbox-triage.spec.ts).
    await page.getByRole('tab', { name: 'Internal note' }).click()
    await page.getByPlaceholder('Add a note…').fill('Fact-check note body')
    await page.getByRole('button', { name: 'Add note', exact: true }).click()
    await expect(page.getByText('Fact-check note body').first()).toBeVisible({
      timeout: 10_000,
    })

    // The manager's REOPEN is the status change under test; the close was the
    // source authority's. The reopen dialog above picked `New information`,
    // which the thread renders as the sentence below — see
    // `MANUAL_REOPEN_WORDS.new_information` in
    // `src/components/inbox/history-event-line.ts`. A reopen by a named manager
    // leads with the name (plan v2.1 row 11: `<name> reopened — new
    // information`); `getByText` without `exact` is a case-insensitive
    // substring match, so this locator reads both leads.
    await expect(page.getByText('Reopened — new information').first()).toBeVisible({
      timeout: 15_000,
    })
    // …and the notification popover shows the content-safe fact… The bell's
    // feed head only refreshes on a 30 s poll, so reload to be sure the row the
    // DB assertion just confirmed has reached the client.
    await page.reload()
    // A click that lands before hydration hits the server-rendered bell, which
    // has no handler yet: the popover never opens and the next assertion fails
    // on "element not found" (seen on main CI, 2026-09-29).
    await waitForHydration(page)
    await clickWhenReady(page.getByRole('button', { name: /notifications/i }).first())
    // …while the notification body never carries the source content. (The
    // reviewer name legitimately renders in the inbox list via the governed
    // live lookup — the assertion targets the notification surface only.
    // Rows from earlier suite runs share the same template, hence .first().)
    const popover = page.locator('[data-radix-popper-content-wrapper]').first()
    await expect(popover.getByText(/review/i).first()).toBeVisible({ timeout: 10_000 })
    expect(await popover.getByText(/SENSITIVE-REVIEWER-NAME-MARKER/).count()).toBe(0)
    expect(await popover.getByText(/SENSITIVE-REVIEW-TEXT-MARKER/).count()).toBe(0)
  })
})
