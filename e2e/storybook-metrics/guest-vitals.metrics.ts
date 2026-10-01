// LCP and CLS of the guest page (round 4, slice 18, board G9): Chromium, a
// PerformanceObserver, `e2e/helpers/web-vitals.ts`. Run with
// `pnpm test:guest:quality`.
//
// ── What is measured, and why not the route ─────────────────────────────────
//
// The plan asks for the seeded v3 portal. There is none yet: the route renders
// the Immersive Hub only for a v3 snapshot, no writer produces one before
// slice 19, and slice 19 owns the seed and the route's mount. Until then the
// only place the real header, rating card, Linktree and footer sit on one page
// is the `ImmersivePage` stories (`guest-page.stories.tsx`), at page height,
// the document scrolling as it does on the route. They are measured in a
// PRODUCTION Storybook build served by `static-server.ts`: a dev server's
// module transforms would be most of any LCP read from it.
//
// What that does not carry: the network. The hero is the stories' SVG photo
// (`STORY_HERO_PHOTO`, a data URI), so the transfer of a real 150 KB JPEG is not
// in the number, and no CPU throttling is applied. Slice 19 repeats this check
// on the seeded portal with a photo uploaded, which is where those costs show.
//
// ── The footer swap ─────────────────────────────────────────────────────────
//
// The server cannot read `localStorage`, so it paints the footer as one
// acknowledged row, and a guest who has not acknowledged sees it swap to the
// taller visit notice after hydration (slice 17, "carried forward"). The
// `FirstVisitNoticeAppearsAfterPaint` story paints the row, then shows the
// notice two frames later: the same two paints. It is measured on a short
// window and a tall one, because the swap only counts while the footer is in
// the viewport.

import { expect, test, type Page } from '@playwright/test'
import { fontSetLinks, type FontLink } from '../../src/shared/font-sets'
import {
  cumulativeLayoutShift,
  installWebVitals,
  readWebVitals,
  vitalsViolations,
} from '../helpers/web-vitals'
import { STORYBOOK_STATIC_DIR } from './storybook-server'
import { openStory } from './storybook-story'

const PAGES = [
  'features-guest-immersivepage--with-photo',
  'features-guest-immersivepage--without-photo',
  'features-guest-immersivepage--first-visit-notice-appears-after-paint',
  'features-guest-immersivepage--german-long-words',
] as const

/** A phone, a tablet, and a desktop window the 480 px column sits in the middle of. */
const WINDOWS = [
  { name: 'phone 375x812', width: 375, height: 812 },
  { name: 'tablet 768x1024', width: 768, height: 1024 },
  { name: 'desktop 1280x900', width: 1280, height: 900 },
] as const

/** The head the root document gives a guest page: the stylesheet and the preloaded pair. */
function guestHeadHtml(links: ReadonlyArray<FontLink>): string {
  return links
    .map((link) =>
      [
        `<link rel="${link.rel}" href="${link.href}"`,
        link.as ? ` as="${link.as}"` : '',
        link.type ? ` type="${link.type}"` : '',
        link.crossOrigin ? ` crossorigin="${link.crossOrigin}"` : '',
        '>',
      ].join(''),
    )
    .join('')
}

/**
 * Put those links in the story iframe's own `<head>`, in the document the
 * server sends, so the preload scanner meets them as it does on the route. A
 * story links the font stylesheet from its body (after Storybook's runtime has
 * booted), which would measure the fonts arriving late and a font swap
 * shifting the page: a cost the route does not pay.
 */
async function serveWithGuestHead(page: Page): Promise<void> {
  const head = guestHeadHtml(fontSetLinks('guest', 'en'))
  await page.route('**/iframe.html*', async (route) => {
    const response = await route.fetch()
    const html = await response.text()
    await route.fulfill({ response, body: html.replace('<head>', `<head>${head}`) })
  })
}

test.describe('LCP and CLS of the Immersive Hub page', () => {
  test.skip(
    STORYBOOK_STATIC_DIR === null,
    'LCP is only meaningful from a production build: run pnpm test:guest:quality (STORYBOOK_METRICS_STATIC)',
  )

  for (const size of WINDOWS) {
    test.describe(size.name, () => {
      test.use({ viewport: { width: size.width, height: size.height } })

      for (const storyId of PAGES) {
        test(storyId, async ({ page }, testInfo) => {
          await serveWithGuestHead(page)
          await installWebVitals(page)
          await openStory(page, storyId, { normalisePadding: false })
          const vitals = await readWebVitals(page)
          // Recorded, so a run says how much room the page has, not only that it passed.
          testInfo.annotations.push({
            type: 'web-vitals',
            description: `LCP ${Math.round(vitals.lcp?.startTime ?? -1)} ms (${vitals.lcp?.element ?? 'none'}), CLS ${cumulativeLayoutShift(vitals.shifts).toFixed(4)}`,
          })
          await testInfo.attach('web-vitals.json', {
            body: JSON.stringify(vitals, null, 2),
            contentType: 'application/json',
          })
          const lines = vitalsViolations(`${storyId} @ ${size.name}`, vitals)
          expect(lines, lines.join('\n')).toEqual([])
        })
      }
    })
  }
})
