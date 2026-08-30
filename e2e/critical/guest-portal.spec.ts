import type { Page } from '@playwright/test'
import { test, expect } from '../helpers/error-detection'
import { requireE2eSeedState } from '../helpers/seed-state'
import { attachRequestLog } from '../helpers/request-log'
import {
  callServerFn,
  callServerFnExpectError,
  callServerFnGet,
  dbQuery,
  resetGuestRateLimits,
} from '../helpers/fixtures'
import { settleGuestConsent } from '../helpers/guest-consent'

const seed = requireE2eSeedState()
const guestMutationServerFile = 'src/contexts/guest/server/public.ts'
const guestQueryServerFile = 'src/contexts/guest/server/guest-scans.ts'
/**
 * Pick a star the way a guest does — by clicking the label.
 *
 * The radio itself is `sr-only`, so it is a 1x1 clipped target that
 * `check()` cannot reliably hit; the visible control is the surrounding
 * `<label>`. Clicking the label is also the more faithful interaction.
 */
const selectRating = async (page: Page, stars: number): Promise<void> => {
  const name = `${stars} ${stars === 1 ? 'star' : 'stars'}`
  await page.locator(`label:has(input[aria-label="${name}"])`).click()
  await expect(page.getByRole('radio', { name })).toBeChecked()
}

test.describe('Critical: public Portal basics', () => {
  // Each journey is a different guest arriving fresh. See resetGuestRateLimits.
  test.beforeEach(async () => {
    await resetGuestRateLimits()
  })

  // The gateway is rating-first ("feat(portal): make guest gateway rating
  // first"): a guest sees the Portal's content and the rating immediately, and
  // the secondary destinations follow the private rating rather than competing
  // with it. Both halves are asserted here, because a Portal that never showed
  // its destinations and a Portal that showed them too early are both defects.
  test('published P1 token renders content immediately and destinations after the rating', async ({
    page,
    context,
  }) => {
    const log = attachRequestLog(page)
    await page.goto(`/p/${seed.portalToken}`)

    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()
    await expect(page.getByRole('radio', { name: '1 star' })).toBeVisible()
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
    expect(sessionCookies.every((cookie) => cookie.secure)).toBe(true)
    await expect(page.getByRole('radio', { name: '5 stars' })).toBeVisible()

    // Not yet — and this half is the one that would silently rot if the flow
    // regressed to showing everything at once.
    await expect(
      page.getByRole('link', { name: 'Visit example review destination' }),
    ).toHaveCount(0)

    await settleGuestConsent(page)
    await selectRating(page, 5)
    await page.getByRole('button', { name: 'Submit private rating' }).click()

    await expect(
      page.getByRole('link', { name: 'Visit example review destination' }),
    ).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()
    expect(log.requests.some((request) => request.url.includes(seed.portalToken))).toBe(
      true,
    )
  })

  test('rating, private feedback, one correction, and withdrawal survive reload', async ({
    page,
  }) => {
    await page.goto(`/p/${seed.portalToken}`)
    await settleGuestConsent(page)

    const destination = page.getByRole('link', {
      name: 'Visit example review destination',
    })
    const expectedDestination = `/api/public/p/${encodeURIComponent(seed.portalToken)}/click/${seed.portalLinkId}`

    await selectRating(page, 2)
    await page.getByRole('button', { name: 'Submit private rating' }).click()
    await expect(
      page.getByText('Thank you. Your private rating was submitted.'),
    ).toBeVisible()

    // The destinations arrive with the receipt, and keep the signed
    // click-through href rather than the raw external URL — the redirect is
    // what attributes the click and keeps the guest's referrer off the target.
    await expect(destination).toHaveAttribute('href', expectedDestination)

    await page
      .getByRole('textbox', { name: 'Private feedback' })
      .fill('Initial private guest note.')
    await page.getByRole('button', { name: 'Send private feedback' }).click()
    // Exact: the receipt panel repeats this sentence with a trailing clause,
    // and the live-region status is the one that proves the send landed.
    await expect(
      page.getByText('Your private feedback was sent to the property team.', {
        exact: true,
      }),
    ).toBeVisible()

    // The rating survives a full document load; the feedback text deliberately
    // does NOT come back, because the receipt promises it is not shown again on
    // this device. Asserting both directions keeps that promise honest.
    await page.reload()
    await expect(page.getByText('You rated this experience 2/5.')).toBeVisible()
    await expect(page.getByText('Initial private guest note.')).toHaveCount(0)
    await expect(destination).toHaveAttribute('href', expectedDestination)

    await page.getByRole('button', { name: 'Change your private rating' }).click()
    await selectRating(page, 5)
    await page.getByRole('button', { name: 'Save rating correction' }).click()
    await expect(page.getByText('You rated this experience 5/5.')).toBeVisible()

    await page.reload()
    await expect(page.getByText('You rated this experience 5/5.')).toBeVisible()

    await page.getByRole('button', { name: 'Withdraw my entire response' }).click()
    await expect(page.getByText('Your response was withdrawn')).toBeVisible()
    await page.reload()
    await expect(page.getByText('Your response was withdrawn')).toBeVisible()
    await expect(page.getByText('You rated this experience')).toHaveCount(0)
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
    await expect(page.getByText('Your response was withdrawn')).toBeVisible()
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
    await expect(page.getByText('You rated this experience 2/5.')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Send private feedback' }),
    ).toBeVisible()
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

    const before = await countScans()

    // One visit records exactly one, and a reload does not add another: the
    // guard is storage-backed plus a use-case dedupe on the signed session, so
    // it survives a full document load rather than only a re-render.
    await page.goto(`/p/${seed.portalToken}`)
    await settleGuestConsent(page)
    await expect(page.getByRole('radio', { name: '1 star' })).toBeVisible()
    await expect.poll(countScans, { timeout: 10_000 }).toBe(before + 1)

    await page.reload()
    await expect(page.getByRole('radio', { name: '1 star' })).toBeVisible()
    expect(await countScans()).toBe(before + 1)

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
    await settleGuestConsent(page)
    await expect.poll(countScans, { timeout: 10_000 }).toBe(before + 2)
  })

  test('P2 and P3 tokens are externally indistinguishable', async ({ page }) => {
    for (const token of [seed.p2PortalToken, seed.p3PortalToken]) {
      await page.goto(`/p/${token}`)
      await expect(
        page.getByRole('heading', { name: 'Portal Unavailable' }),
      ).toBeVisible()
      await expect(page.getByText('Please try again later.')).toBeVisible()
      await expect(page.getByText(/E2E Guest Portal P[23]/)).toHaveCount(0)
    }
  })
})
