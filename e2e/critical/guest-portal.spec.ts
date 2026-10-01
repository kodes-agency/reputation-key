import type { Page } from '@playwright/test'
import { test, expect } from '../helpers/error-detection'
import { signIn } from '../helpers/auth'
import { requireE2eSeedState } from '../helpers/seed-state'
import { attachRequestLog } from '../helpers/request-log'
import {
  callServerFn,
  callServerFnExpectError,
  callServerFnGet,
  dbQuery,
  e2eRunId,
  getFeedbackHandlingOutcomes,
  refreshPortalDestinationApproval,
  resetGuestRateLimits,
  waitFor,
} from '../helpers/fixtures'
import { settleGuestConsent } from '../helpers/guest-consent'
import { expectPortalUnavailable } from '../helpers/guest-unavailable'

const seed = requireE2eSeedState()
const guestMutationServerFile = 'src/contexts/guest/server/public.ts'
const guestQueryServerFile = 'src/contexts/guest/server/guest-scans.ts'
/** The English pack's word for each star: a choice is named "2 stars, Fair". */
const RATING_WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'] as const

const ratingName = (stars: number): string =>
  `${stars} ${stars === 1 ? 'star' : 'stars'}, ${RATING_WORDS[stars - 1]}`

/**
 * Pick a star the way a guest does — by clicking the label.
 *
 * The radio itself is `sr-only`, so it is a 1x1 clipped target that
 * `check()` cannot reliably hit; the visible control is the surrounding
 * `<label>`. Clicking the label is also the more faithful interaction.
 */
const selectRating = async (page: Page, stars: number): Promise<void> => {
  const name = ratingName(stars)
  await page.locator(`label:has(input[aria-label="${name}"])`).click()
  await expect(page.getByRole('radio', { name })).toBeChecked()
}

/** The Linktree tile the seed publishes for P1: a link from arrival, in every state. */
const seededTile = (page: Page) =>
  page.getByRole('link', { name: 'Visit example review destination' })

/** The receipt that opens the after-rating page: "Fair · sent privately". */
const receipt = (page: Page, stars: number) =>
  page.getByText(`${RATING_WORDS[stars - 1]} · sent privately`)

/** Open "Your response", the guest's own controls, which the page keeps collapsed. */
const openYourResponse = async (page: Page): Promise<void> => {
  const toggle = page.getByRole('button', { name: /^Your response/ })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

test.describe('Critical: public Portal basics', () => {
  // Each journey is a different guest arriving fresh. See resetGuestRateLimits.
  test.beforeEach(async () => {
    await resetGuestRateLimits()
    await refreshPortalDestinationApproval()
  })

  // The Immersive Hub (schema v3, ADR 0044 as amended): the rating card is first
  // and dominant, and the Linktree is visible from arrival. A guest who has not
  // rated sees the Portal's content, the rating and the tiles at once; the
  // Google card is the one thing that waits for a rating.
  test('published P1 token renders the Immersive Hub with its Linktree from arrival', async ({
    page,
    context,
  }) => {
    const log = attachRequestLog(page)
    await page.goto(`/p/${seed.portalToken}`)

    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()
    await expect(page.getByRole('radio', { name: ratingName(1) })).toBeVisible()
    await expect(page.getByRole('radio', { name: ratingName(5) })).toBeVisible()
    await expect(seededTile(page)).toBeVisible()
    // The seeded portal is a v3 publication, so it wears the self-hosted guest
    // fonts and contacts no font CDN at all (the legacy page asserts the
    // opposite: see the schema v2 spec below).
    log.assertNoFontCdnRequests()
    expect(log.requests.some((request) => request.url.includes('/fonts/guest/'))).toBe(
      true,
    )
    const sessionCookies = (await context.cookies()).filter(
      (cookie) => cookie.name === 'rk_guest_session',
    )
    // Three scopes, not two: the guest session is issued for the page (/p/),
    // the server functions it calls (/_serverFn/), and the click-through
    // endpoint (/api/public/p/). The third was added with the public-portal
    // observation hardening and is asserted positionally in
    // guest-session.test.ts; this stays an exact set so a fourth scope — a
    // wider one — cannot appear unnoticed.
    expect(sessionCookies.map((cookie) => cookie.path).sort()).toEqual([
      '/_serverFn/',
      '/api/public/p/',
      '/p/',
    ])
    expect(sessionCookies.every((cookie) => cookie.httpOnly)).toBe(true)
    expect(sessionCookies.every((cookie) => cookie.sameSite === 'Lax')).toBe(true)
    // `Secure` follows NODE_ENV=production (composition.ts) and the stack runs
    // the production build under NODE_ENV=test; guest-session.test.ts covers it.

    // Not yet: Google waits for a rating, and says the same after every one.
    await expect(page.getByRole('button', { name: /^Continue to Google/ })).toHaveCount(0)

    await settleGuestConsent(page, 'immersive')
    await selectRating(page, 5)
    await page.getByRole('button', { name: 'Send privately' }).click()

    await expect(receipt(page, 5)).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Share your experience on Google' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /^Continue to Google/ })).toBeVisible()
    // The tiles stay where they were; the rating did not move them.
    await expect(seededTile(page)).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()
    await expect(receipt(page, 5)).toBeVisible()
    expect(log.requests.some((request) => request.url.includes(seed.portalToken))).toBe(
      true,
    )
  })

  test('rating, private note, one correction, and withdrawal survive reload', async ({
    page,
  }) => {
    await page.goto(`/p/${seed.portalToken}`)
    await settleGuestConsent(page, 'immersive')

    const expectedDestination = `/api/public/p/${encodeURIComponent(seed.portalToken)}/click/${seed.portalLinkId}`

    await selectRating(page, 2)
    await page.getByRole('button', { name: 'Send privately' }).click()
    await expect(receipt(page, 2)).toBeVisible()
    // The tile was a plain link before the rating and stays one: a tap on it
    // goes through the click route, which attributes it and keeps the guest's
    // referrer off the target.
    await expect(seededTile(page)).toHaveAttribute('href', expectedDestination)

    // A rating at or below the threshold is offered a private note.
    await page.getByRole('button', { name: 'Write a private note' }).click()
    await page
      .getByRole('textbox', { name: 'Your note (optional)' })
      .fill('Initial private guest note.')
    await page.getByRole('button', { name: 'Send note privately' }).click()
    await expect(
      page.getByText('Your note was sent privately to E2E Guest Portal P1.'),
    ).toBeVisible()

    // The rating survives a full document load; the note text deliberately
    // does NOT come back, because the page promises it is not shown again on
    // this device. Asserting both directions keeps that promise honest.
    await page.reload()
    await expect(receipt(page, 2)).toBeVisible()
    await expect(page.getByText('Initial private guest note.')).toHaveCount(0)
    await expect(seededTile(page)).toHaveAttribute('href', expectedDestination)

    // The receipt's Change opens "Your response" on the rating form.
    await page.getByRole('button', { name: 'Change', exact: true }).click()
    await selectRating(page, 5)
    await page.getByRole('button', { name: 'Save new rating' }).click()
    await expect(page.getByText('Your rating was updated.')).toBeVisible()
    await expect(receipt(page, 5)).toBeVisible()

    await page.reload()
    await expect(receipt(page, 5)).toBeVisible()

    // Removing everything asks first: the note makes it the "rating and note" row.
    await openYourResponse(page)
    await page.getByRole('button', { name: /^Remove….*rating and note/ }).click()
    await page.getByRole('button', { name: 'Remove both' }).click()
    await expect(page.getByText('Your response was removed')).toBeVisible()
    await page.reload()
    await expect(page.getByText('Your response was removed')).toBeVisible()
    await expect(page.getByText('· sent privately')).toHaveCount(0)
  })

  test('private feedback reaches the manager Inbox and can be marked handled', async ({
    page,
  }) => {
    const feedbackBody = `Joined guest feedback ${e2eRunId}: the room heater needs attention.`
    const existingResponseIds = new Set(
      (
        await dbQuery<{ response_id: string }>(
          `SELECT response_id::text AS response_id
           FROM guest_response_private_feedback
           WHERE portal_id = $1::uuid AND body = $2`,
          [seed.portalId, feedbackBody],
        )
      ).map((row) => row.response_id),
    )

    await page.goto(`/p/${seed.portalToken}`)
    await settleGuestConsent(page, 'immersive')
    await selectRating(page, 2)
    await page.getByRole('button', { name: 'Send privately' }).click()
    await expect(receipt(page, 2)).toBeVisible()
    await page.getByRole('button', { name: 'Write a private note' }).click()
    await page.getByRole('textbox', { name: 'Your note (optional)' }).fill(feedbackBody)
    await page.getByRole('button', { name: 'Send note privately' }).click()
    await expect(
      page.getByText('Your note was sent privately to E2E Guest Portal P1.'),
    ).toBeVisible()

    const responseId = await waitFor(
      async () => {
        const rows = await dbQuery<{ response_id: string }>(
          `SELECT response_id::text AS response_id
           FROM guest_response_private_feedback
           WHERE portal_id = $1::uuid AND body = $2
           ORDER BY submitted_at DESC`,
          [seed.portalId, feedbackBody],
        )
        return rows.find((row) => !existingResponseIds.has(row.response_id))?.response_id
      },
      { timeoutMs: 10_000, description: 'new private feedback response persisted' },
    )
    const inboxItem = await waitFor(
      async () => {
        const rows = await dbQuery<{ id: string }>(
          `SELECT id::text AS id
           FROM inbox_items
           WHERE organization_id = $1 AND property_id = $2
             AND source_type = 'feedback' AND source_id = $3::uuid`,
          [seed.organizationId, seed.p1PropertyId, responseId],
        )
        return rows[0] ?? null
      },
      {
        description: 'manager Inbox item for submitted private feedback',
        diagnose: () =>
          dbQuery(
            `SELECT event_type, published_at, payload
             FROM outbox_events
             WHERE organization_id = $1 AND payload::text LIKE $2
             ORDER BY created_at DESC`,
            [seed.organizationId, `%${responseId}%`],
          ),
      },
    )

    await signIn(page)
    await page.goto(`/inbox?itemId=${inboxItem.id}`)
    // The pane has no `Feedback handling` heading any more (PR 5 deleted the
    // section it titled); the load gate is the control this journey uses.
    await expect(page.getByRole('button', { name: 'Mark as handled' })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: 'Mark as handled' }).click()
    const markDialog = page.getByRole('dialog')
    await expect(markDialog.getByText('Mark feedback as handled')).toBeVisible()
    await markDialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Follow-up completed' }).click()
    await markDialog
      .getByPlaceholder('Add context that will help other managers')
      .fill('Called the guest and arranged a heater inspection.')
    await markDialog.getByRole('button', { name: 'Mark as handled' }).click()
    const outcomes = await waitFor(
      async () => {
        const rows = await getFeedbackHandlingOutcomes(inboxItem.id)
        return rows.length === 1 ? rows : null
      },
      { timeoutMs: 10_000, description: 'handling outcome recorded' },
    )
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({
      outcome: 'follow_up_completed',
      outcome_revision: 1,
    })
  })

  // Media is gone from the guest gateway -- issueGuestMediaFn and
  // confirmGuestMediaFn no longer exist, and the response carries a rating and
  // an optional private note only. What remains worth pinning is that a
  // replayed submit creates ONE response, and that withdrawal removes its
  // content rather than only hiding it.
  test('guest replay is idempotent and withdrawal removes the content', async ({
    page,
  }) => {
    await page.goto(`/p/${seed.portalToken}`)
    const loaded = await callServerFnGet<{
      guestSession: { csrfNonce: string }
      response: null
    }>(page, {
      file: guestQueryServerFile,
      exportName: 'getPublicPortal',
      data: { token: seed.portalToken },
    })
    const payload = {
      token: seed.portalToken,
      csrfNonce: loaded.guestSession.csrfNonce,
      rating: 4,
      text: null,
      responseConsent: true,
      textConsent: false,
      mediaConsent: true,
    }
    // A DELTA, not an absolute count: this Portal is shared with the other
    // journeys in this file and with earlier runs, so "one row exists" would
    // only ever have been true on a pristine database.
    const countResponses = async (): Promise<number> =>
      Number(
        (
          await dbQuery<{ n: string }>(
            `SELECT count(*)::text AS n FROM guest_responses
             WHERE portal_id = $1 AND deleted_at IS NULL`,
            [seed.portalId],
          )
        )[0]?.n ?? '0',
      )
    const before = await countResponses()

    const first = await callServerFn<{ status: string; submittedAt: string }>(page, {
      file: guestMutationServerFile,
      exportName: 'submitGuestResponseFn',
      data: payload,
    })
    const replay = await callServerFn<{ status: string; submittedAt: string }>(page, {
      file: guestMutationServerFile,
      exportName: 'submitGuestResponseFn',
      data: payload,
    })
    expect(replay).toEqual(first)

    const persisted = await callServerFnGet<{
      response: { status: string; rating: number; submittedAt: string }
    }>(page, {
      file: guestQueryServerFile,
      exportName: 'getPublicPortal',
      data: { token: seed.portalToken },
    })
    // The public view deliberately carries no response id, so identity is
    // asserted where it actually matters: one row, not two.
    expect(persisted.response).toMatchObject({
      status: 'submitted',
      rating: 4,
      submittedAt: first.submittedAt,
    })
    expect(await countResponses()).toBe(before + 1)

    await callServerFn(page, {
      file: guestMutationServerFile,
      exportName: 'withdrawGuestResponseFn',
      data: {
        token: seed.portalToken,
        csrfNonce: loaded.guestSession.csrfNonce,
      },
    })
    const withdrawn = await callServerFnGet<{
      response: { status: string; rating: null }
    }>(page, {
      file: guestQueryServerFile,
      exportName: 'getPublicPortal',
      data: { token: seed.portalToken },
    })
    // Withdrawal must ERASE, not hide: a status flip with the rating still
    // readable would satisfy the UI and break the promise made to the guest.
    expect(withdrawn.response).toMatchObject({ status: 'deleted', rating: null })

    await page.reload()
    await expect(page.getByText('Your response was removed')).toBeVisible()
  })

  // Guest media is gone from the gateway, so the oversize case is now the
  // surviving unbounded input: private feedback. The cross-property case is
  // unchanged and is the security-relevant half -- a session signed for P1
  // must buy nothing at P2, even with a valid CSRF nonce.
  test('oversize and cross-property guest mutations are inert', async ({ page }) => {
    await page.goto(`/p/${seed.portalToken}`)
    const loaded = await callServerFnGet<{ guestSession: { csrfNonce: string } }>(page, {
      file: guestQueryServerFile,
      exportName: 'getPublicPortal',
      data: { token: seed.portalToken },
    })

    // A rating first: private feedback is only offered on a rated response, so
    // without one the oversize case would be rejected for the wrong reason.
    await callServerFn(page, {
      file: guestMutationServerFile,
      exportName: 'submitGuestResponseFn',
      data: {
        token: seed.portalToken,
        csrfNonce: loaded.guestSession.csrfNonce,
        rating: 2,
        text: null,
        responseConsent: true,
        textConsent: false,
        mediaConsent: false,
      },
    })

    const oversize = await callServerFnExpectError(page, {
      file: guestMutationServerFile,
      exportName: 'submitPrivateFeedbackFn',
      data: {
        token: seed.portalToken,
        csrfNonce: loaded.guestSession.csrfNonce,
        // One past MAX_PRIVATE_FEEDBACK_LENGTH: the client caps the textarea at
        // 2000, so only a direct call can prove the server does too.
        text: 'x'.repeat(2001),
      },
    })
    expect(oversize.message ?? '').toMatch(/error|invalid|long|large/i)

    const crossProperty = await callServerFnExpectError(page, {
      file: guestMutationServerFile,
      exportName: 'submitGuestResponseFn',
      data: {
        token: seed.p2PortalToken,
        csrfNonce: loaded.guestSession.csrfNonce,
        rating: 5,
        responseConsent: true,
      },
    })
    expect(crossProperty.message ?? '').toMatch(/error|request|completed/i)

    // Neither refusal may leave a mark: the guest still sees their own rated
    // response, with no private feedback attached.
    await page.reload()
    await expect(receipt(page, 2)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Write a private note' })).toBeVisible()
  })

  // The portal.scan metric had NO producer: recordScanFn was exported and
  // catalogued but never called, so the analytics tab showed Scans 0 on a
  // portal with real traffic. `GuestAnalyticsNotice` is now that producer — it
  // records the visit from a mount effect, once per browser session.
  //
  // Recording is NOT gated on acknowledging the notice. It was, under the
  // Accept/Reject `CookieConsentBanner`; "fix(guest): harden public portal
  // observations" replaced that with an informational notice, so what this
  // asserts is the dedupe, which is the half that can regress silently.
  test('the scan metric has a producer and one session counts once', async ({
    page,
    context,
  }) => {
    const countScans = async () =>
      Number(
        (
          await dbQuery<{ n: string }>(
            `SELECT count(*)::text AS n FROM metric_readings
             WHERE portal_id = $1 AND metric_key = 'portal.scan'`,
            [seed.portalId],
          )
        )[0]?.n ?? '0',
      )

    // Scans reach `metric_readings` through the outbox, so a reading from an
    // earlier test in this file can land after this one has started (main run
    // for d911d146: expected 6, received 7 after the reload). A count only
    // means something once it has held still for two relay ticks.
    const settledScanCount = async () => {
      let last = await countScans()
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await page.waitForTimeout(2_000)
        const next = await countScans()
        if (next === last) return next
        last = next
      }
      throw new Error('portal.scan readings did not settle within 20s')
    }
    const before = await settledScanCount()

    // One visit records exactly one, and a reload does not add another: the
    // guard is storage-backed plus a use-case dedupe on the signed session, so
    // it survives a full document load rather than only a re-render.
    await page.goto(`/p/${seed.portalToken}`)
    await settleGuestConsent(page, 'immersive')
    await expect(page.getByRole('radio', { name: ratingName(1) })).toBeVisible()
    // Main run 33685556953 exhausted 10s (expected 8, received 7), then passed
    // on retry: the durable path includes the relay tick plus cold BullMQ startup.
    await expect.poll(countScans, { timeout: 20_000 }).toBe(before + 1)

    await page.reload()
    await expect(page.getByRole('radio', { name: ratingName(1) })).toBeVisible()
    expect(await settledScanCount()).toBe(before + 1)

    // A DIFFERENT guest counts again, which is what proves the dedupe is
    // scoped to the session rather than to the portal. The reset has to be a
    // whole device and not just its cookies: both the acknowledgement and the
    // visit marker live in browser storage, so clearing cookies alone leaves a
    // guest the notice never shows again and the visit never re-records for.
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await context.clearCookies()
    await page.goto(`/p/${seed.portalToken}`)
    await settleGuestConsent(page, 'immersive')
    await expect.poll(countScans, { timeout: 10_000 }).toBe(before + 2)
  })

  test('P2 and P3 tokens are externally indistinguishable', async ({ page }) => {
    for (const token of [seed.p2PortalToken, seed.p3PortalToken]) {
      await page.goto(`/p/${token}`)
      await expectPortalUnavailable(page)
      await expect(page.getByText(/E2E Guest Portal P[23]/)).toHaveCount(0)
    }
  })
})
