// The Immersive Hub on the SEEDED v3 portal (round 4, slice 19): the quality
// gate of slice 18 (`pnpm test:guest:quality`) measures the page's pieces in
// Storybook because no route mounted them. They are mounted now, and this is the
// same check on the real route: the self-hosted fonts, LCP and CLS.
//
// Chromium only, which is the only browser the `critical` project runs:
// `largest-contentful-paint` and `layout-shift` are not exposed by WebKit or
// Firefox (see `e2e/helpers/web-vitals.ts`). The seed publishes the
// default look and no photo, so the largest paint is the display name; the
// photo case is the Storybook gate's, until uploads are in a seed.
//
// Not run by the slice's author: it needs the local stack, which the slice's
// rules forbid starting. It reads the same helpers the Storybook gate does.

import { test, expect } from '../helpers/error-detection'
import { attachRequestLog } from '../helpers/request-log'
import { requireE2eSeedState } from '../helpers/seed-state'
import { installWebVitals, readWebVitals, vitalsViolations } from '../helpers/web-vitals'
import { settleGuestConsent } from '../helpers/guest-consent'
import { resetGuestRateLimits } from '../helpers/fixtures'

const seed = requireE2eSeedState()
const GUEST_STYLESHEET = '/fonts/guest/guest-fonts.css'
/** Long enough that a late font would shift text if the fallbacks did not hold the metrics. */
const FONT_DELAY_MS = 1500

test.describe('Critical: Immersive Hub quality on the seeded portal', () => {
  test.beforeEach(async () => {
    await resetGuestRateLimits()
  })

  test('serves the guest fonts from this origin and links their stylesheet in the document head', async ({
    page,
  }) => {
    const log = attachRequestLog(page)

    // The served document, before any script runs: the stylesheet is what
    // carries the size-adjusted fallbacks and the font tokens, so a head that
    // loses it is the failure this guards. The Storybook gate cannot see it.
    const html = await (await page.request.get(`/p/${seed.portalToken}`)).text()
    const head = html.slice(0, html.indexOf('</head>'))
    const link = head
      .match(/<link\b[^>]*>/gu)
      ?.find((tag) => tag.includes(`href="${GUEST_STYLESHEET}"`))
    expect(link, 'the guest font stylesheet is linked in the head').toBeDefined()
    expect(link).toContain('rel="stylesheet"')

    await page.goto(`/p/${seed.portalToken}`)
    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()
    log.assertNoFontCdnRequests()
    expect(log.requests.some((request) => request.url.endsWith(GUEST_STYLESHEET))).toBe(
      true,
    )
    expect(
      log.requests.some((request) => /\/fonts\/guest\/.+\.woff2$/u.test(request.url)),
    ).toBe(true)
  })

  test('holds its LCP and CLS budgets on a first visit', async ({ page }) => {
    await installWebVitals(page)

    await page.goto(`/p/${seed.portalToken}`)
    // A first visit: the footer swaps from one acknowledged row to the notice
    // once the page has hydrated, which is the shift slice 18 measured.
    await settleGuestConsent(page, 'immersive')
    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()

    expect(vitalsViolations('seeded v3 portal', await readWebVitals(page))).toEqual([])
  })

  test('holds its CLS budget while every font file is still on its way', async ({
    page,
  }) => {
    // Each woff2 is delayed, so the page paints with the size-adjusted fallbacks
    // and swaps late: with the stylesheet in the head the swap moves nothing.
    await page.route(/\/fonts\/guest\/.+\.woff2$/u, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, FONT_DELAY_MS))
      await route.continue()
    })
    await installWebVitals(page)
    const fontArrived = page.waitForResponse(/\/fonts\/guest\/.+\.woff2$/u)

    await page.goto(`/p/${seed.portalToken}`)
    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()
    // Wait for the swap itself, not for a guess at how long it takes: a delayed
    // file has arrived, every font the page asked for is loaded, and two frames
    // have painted with them before the shifts are read.
    await fontArrived
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )

    const vitals = await readWebVitals(page)
    expect(
      vitalsViolations('seeded v3 portal with delayed fonts', {
        ...vitals,
        // LCP under a deliberate 1.5 s font delay is not what this test judges.
        lcp: vitals.lcp && { ...vitals.lcp, startTime: 0 },
      }),
    ).toEqual([])
  })
})
