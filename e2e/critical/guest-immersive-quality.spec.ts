// Quality on the seeded Immersive Hub: self-hosted fonts, LCP, CLS and
// downloaded bytes through a phone visit, rating and private note.
//
// Chromium only, which is the only browser the `critical` project runs:
// `largest-contentful-paint` and `layout-shift` are not exposed by WebKit or
// Firefox (see `e2e/helpers/web-vitals.ts`). The seed publishes the
// default look and no photo, so the largest paint is the display name; the
// photo case is the Storybook gate's, until uploads are in a seed.

import { devices, type Page, type TestInfo } from '@playwright/test'
import { test, expect } from '../helpers/error-detection'
import { attachRequestLog } from '../helpers/request-log'
import { requireE2eSeedState } from '../helpers/seed-state'
import { installWebVitals, readWebVitals, vitalsViolations } from '../helpers/web-vitals'
import { settleGuestConsent } from '../helpers/guest-consent'
import { resetGuestRateLimits } from '../helpers/fixtures'
import { assertDownloadBudget, attachDownloadLog } from '../helpers/download-log'

const seed = requireE2eSeedState()
const GUEST_STYLESHEET = '/fonts/guest/guest-fonts.css'
/** Long enough that a late font would shift text if the fallbacks did not hold the metrics. */
const FONT_DELAY_MS = 1500
// PROVISIONAL owner-controlled ceiling. Replace before merge with the normal
// built CI journey's measured total plus 10% (rounded up).
const GUEST_DOWNLOAD_LIMIT_BYTES = 2_000_000

async function checkGuestPhoneDownloads(
  page: Page,
  testInfo: TestInfo,
  excessDownload: boolean,
) {
  const finishDownloads = attachDownloadLog(page)

  await page.goto(`/p/${seed.portalToken}`)
  await settleGuestConsent(page, 'immersive')
  await page.locator('label:has(input[aria-label="2 stars, Fair"])').click()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('Fair · sent')).toBeVisible()
  await page.getByRole('button', { name: 'Report the issue' }).click()
  await page
    .getByRole('textbox', { name: 'Your note (optional)' })
    .fill('Guest quality check.')
  await page.getByRole('button', { name: 'Send note' }).click()
  await expect(page.getByText('Your note was sent to E2E Guest Portal P1.')).toBeVisible()

  if (excessDownload) {
    // Bypass the cache so the negative control adds real response bytes.
    await page.evaluate(async (limitBytes) => {
      const font = performance
        .getEntriesByType('resource')
        .find((entry) => /\/fonts\/guest\/.+\.woff2$/u.test(entry.name))
      if (!font) throw new Error('No guest font available for excess download')
      const download = async () => {
        const response = await fetch(font.name, { cache: 'no-store' })
        if (!response.ok) throw new Error('Excess font download failed')
        const bytes = (await response.arrayBuffer()).byteLength
        if (bytes === 0) throw new Error('Excess font download was empty')
        return bytes
      }
      const fontBytes = await download()
      for (let remaining = Math.ceil(limitBytes / fontBytes); remaining > 0; remaining--)
        await download()
    }, GUEST_DOWNLOAD_LIMIT_BYTES)
  }

  const downloads = await finishDownloads()
  console.log(
    `[guest-download-bytes] ${downloads.bytes} (${excessDownload ? 'planted excess' : 'normal journey'})`,
  )
  await testInfo.attach('guest-downloads', {
    body: JSON.stringify(
      { unit: 'encoded response body + response header bytes', ...downloads },
      null,
      2,
    ),
    contentType: 'application/json',
  })
  if (excessDownload) expect(downloads.bytes).toBeGreaterThan(GUEST_DOWNLOAD_LIMIT_BYTES)
  assertDownloadBudget(downloads, GUEST_DOWNLOAD_LIMIT_BYTES)
}

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

  test.describe('guest phone downloads', () => {
    test.use({ ...devices['Pixel 7'] })

    test('holds its download budget through a rating and private note', async ({
      page,
    }, testInfo) => {
      await checkGuestPhoneDownloads(page, testInfo, false)
    })

    test('rejects planted excess downloads through a rating and private note', async ({
      page,
    }, testInfo) => {
      await expect(checkGuestPhoneDownloads(page, testInfo, true)).rejects.toThrow(
        new RegExp(
          `^Guest downloaded \\d+ bytes; fixed limit is ${GUEST_DOWNLOAD_LIMIT_BYTES} bytes$`,
          'u',
        ),
      )
    })
  })
})
