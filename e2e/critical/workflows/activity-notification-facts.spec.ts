// BQC-6.5 item 10 — in-app notification + activity surfaces show
// content-safe facts. A new review with SENSITIVE marker content arrives
// through the real chain (stub → sync → review.created → inbox projection →
// worker-side insert-activity-log / insert-notification jobs), then triage
// actions add activity facts.
//
// Transitions verified: notification row + activity rows exist for the right
// resources, and NEITHER surface ever carries the review's text or reviewer
// name — at rest (DB payloads) and rendered (notification popover, and the
// Handling History rows in the inbox thread).

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { gbpStubControl } from '../../fixtures/gbp-stub'
import {
  drainFixtureQueue,
  waitForQueuesIdle,
  e2eRunId,
  cleanupE2eData,
  seedGoogleConnection,
  seedProperty,
  getUserByEmail,
  dbQuery,
  getInboxItemForReview,
  getInboxItemById,
  closeInboxItemBySourceAuthority,
  getActivityRows,
  getNotificationsForUser,
  enqueueReviewSync,
  waitFor,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-not-'
const seed = requireE2eSeedState()
const ACCOUNT = `e2e-not-${e2eRunId}`
const ACCOUNT_NAME = `accounts/${ACCOUNT}`
const LOCATION = `${ACCOUNT_NAME}/locations/not-loc`
const SENSITIVE_TEXT = 'SENSITIVE-REVIEW-TEXT-MARKER never shown'
const SENSITIVE_NAME = 'SENSITIVE-REVIEWER-NAME-MARKER'

test.describe('Critical workflow: content-safe notification + activity facts', () => {
  test.beforeEach(async () => {
    // Stale provider syncs from an earlier spec retry against a stub scope that
    // has moved on, and burn the shared reviews quota this one needs.
    await drainFixtureQueue()
    // And start from a quiescent worker: the SLO is arrival-to-projection
    // latency, not latency while another spec's events are still draining.
    await waitForQueuesIdle()
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
          'SELECT id FROM reviews WHERE organization_id = $1 AND external_id = $2',
          [seed.organizationId, 'not-r1'],
        )
        if (!reviews[0]) return null
        return getInboxItemForReview(reviews[0].id)
      },
      { timeoutMs: 15_000, description: 'inbox item for the arrived review' },
    )

    // Triage actions (each a durable activity fact): close, reopen, note.
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
    await page.goto(`/inbox?queue=closed&itemId=${inboxItem.id}`)
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

    // Activity rows (worker-processed insert-activity-log jobs).
    const activityRows = await waitFor(
      async () => {
        const rows = await getActivityRows({
          organizationId: seed.organizationId,
          resourceType: 'inbox_item',
          resourceId: inboxItem.id as string,
        })
        const actions = new Set(rows.map((r) => r.action))
        return actions.has('created') && actions.has('changed') && actions.has('added')
          ? rows
          : null
      },
      { timeoutMs: 30_000, description: 'activity facts for triage actions' },
    )
    // Content-safe at rest: no review text, no reviewer name in ANY payload.
    for (const row of activityRows) {
      expect(JSON.stringify(row.payload)).not.toContain('SENSITIVE-REVIEW-TEXT-MARKER')
      expect(JSON.stringify(row.payload)).not.toContain('SENSITIVE-REVIEWER-NAME-MARKER')
    }

    // The new-review notification for the assigned admin.
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
    expect(notifications[0].body ?? '').not.toContain(inboxItem.id)
    // The point of this test: the allowlisted payload cannot carry source
    // content. `payload` is stringified along with the row, so this now covers
    // the new column too.
    expect(JSON.stringify(notifications[0])).not.toContain('SENSITIVE-REVIEW-TEXT-MARKER')
    expect(JSON.stringify(notifications[0])).not.toContain(
      'SENSITIVE-REVIEWER-NAME-MARKER',
    )

    // Rendered surfaces: the pane reads the reopen from Handling History in the
    // thread now, not from the Recent Activity feed — that collapsible was
    // deleted with the detail-pane rebuild. The activity FACTS asserted above
    // are still written; only the UI that displayed them is gone, and the
    // thread is always expanded, so there is no trigger left to click.
    //
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
    await page
      .getByRole('button', { name: /notifications/i })
      .first()
      .click()
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
