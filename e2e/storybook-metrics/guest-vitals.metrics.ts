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
// notice two frames later: the same two paints. On a window as tall as the page
// the footer is pinned to the bottom, so the notice pushes its top edge UP and
// that is the shift (it is the only element that moves: 0.0033 at 768x1024,
// 0.0062 at 430x932, the largest measured, 0.0018 at 1280x900). WINDOWS has
// all four.

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

/**
 * A phone, the largest phone window measured to shift most when the footer
 * swaps (430x932: the page is the window's height, so the footer is pinned to
 * the bottom and moves up), a tablet, and a desktop window the 480 px column
 * sits in the middle of.
 */
const WINDOWS = [
  { name: 'phone 375x812', width: 375, height: 812 },
  { name: 'large phone 430x932', width: 430, height: 932 },
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
 * server sends. What matters is the STYLESHEET being there, render-blocking:
 * `public/fonts/guest/guest-fonts.css` holds the size-adjusted fallback
 * `@font-face` rules and the `--font-guest-*` tokens, so a page that paints
 * before it has arrived paints in the wrong face with no metric-matched
 * fallback, and the late sheet re-wraps the long words. A story links the
 * stylesheet from its body, after Storybook's runtime has booted, which is
 * exactly that: it measured CLS 0.141 on the German long-words page at 375 px
 * (three runs in four). With the stylesheet in the head and every woff2
 * delayed 1,500 ms, CLS is 0.0000 to 0.0002 whether or not the preloads are
 * there: the fallbacks hold, and the preloads are an LCP nicety that carries no
 * CLS weight. They stay in the head here only because the route emits them.
 *
 * What this does NOT do is guard the route. The head below is built from
 * `fontSetLinks('guest', 'en')` here, not rendered by `__root.tsx`'s
 * `FontSetLinks`, so a route that stopped emitting the stylesheet would leave
 * this test green. That guarantee belongs to slice 19's seeded-route check
 * (the plan's slice 18 notes say what it must assert).
 *
 * Throws when nothing was replaced: if Storybook ever writes `<head>` with
 * attributes, a silent no-op would measure without the links and could pass for
 * the wrong reason, or flip to the 0.141 case.
 */
const HEAD_OPENING_TAG = /<head(\s[^>]*)?>/u

async function serveWithGuestHead(page: Page): Promise<void> {
  const head = guestHeadHtml(fontSetLinks('guest', 'en'))
  await page.route('**/iframe.html*', async (route) => {
    const response = await route.fetch()
    const html = await response.text()
    const injected = html.replace(HEAD_OPENING_TAG, (opening) => `${opening}${head}`)
    if (injected === html) {
      throw new Error(
        `iframe.html has no <head> to put the guest font links in; the vitals would be measured without them`,
      )
    }
    await route.fulfill({ response, body: injected })
  })
}

test.describe('LCP and CLS of the Immersive Hub page', () => {
  test.skip(
    STORYBOOK_STATIC_DIR === null,
    'LCP is only meaningful from a production build: run pnpm test:guest:quality (STORYBOOK_METRICS_STATIC)',
  )

  // One tab at a time: LCP is a paint time, and under `fullyParallel` other
  // Chromium instances compete for the CPU while it is read (about 140 ms
  // alone, 470 to 1,100 ms in parallel), so the figure would be the machine's
  // load, not the page's. `default` mode runs the group in order on one worker,
  // and unlike `serial` a failure does not skip the tests after it.
  test.describe.configure({ mode: 'default' })

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
