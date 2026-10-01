// The guest page's geometry and motion gate (round 4, slice 18, board G9).
// Run with `pnpm test:guest:quality` (it builds Storybook and serves the build),
// or with `pnpm test:storybook:metrics` against the dev server. Either way the
// stories must be rendered by a DEVELOPMENT bundle: their plays read the DOM
// straight after the render, which a production bundle does not flush
// (`scripts/e2e/guest-quality.sh` says why, and builds the right one).
//
// For every story `guest-stories.ts` declares, against Storybook with Tailwind
// compiled, at 320, 375 and 768 px:
//
//   1. every interactive element is >= 44 px on its smaller side (a hidden
//      radio is judged by the label a finger presses, `pane-metrics.ts`);
//   2. neither the page nor any scroller inside it overflows sideways, no shown
//      element reaches past the box that clips it, and the document does not
//      scroll sideways — which is what a word that cannot break (German
//      compounds, a long property name) does to a narrow phone;
//   3. under `prefers-reduced-motion: reduce` nothing on the page transitions or
//      animates (computed style of every element and pseudo-element, and the
//      browser's own list of running animations).
//
// ── How a story is put at a width ───────────────────────────────────────────
//
// The stories draw a phone in a fixed 390 px frame (three stories declare their
// own: footer, response, linktree) and their plays assert against it. So a story
// is opened at 390 px, exactly as its play expects, and only AFTER the play has
// finished is the window set to the width under test and the frame's own width
// set to match. Everything below the frame is then laid out at that width, and
// the viewport units the page uses (`vw`, `dvh`) answer the same window.
//
// ── What this cannot see ────────────────────────────────────────────────────
//
// Stories, not the route: the public route does not render the v3 page until
// slice 19. Chromium only. A layer the harness does not open (the sheet is
// opened by its own stories' plays, so those are measured open).

import { expect, test, type Page } from '@playwright/test'
import { accountForStories, type StoryIndexEntry } from '../helpers/story-accounting'
import {
  EXCLUDED_GUEST_STORIES,
  EXCLUDED_GUEST_TITLES,
  GUEST_PANE_SELECTOR,
  GUEST_STORY_IMPORT_PREFIXES,
  GUEST_TARGET_MIN_PX,
  GUEST_VIEWPORT_HEIGHT,
  GUEST_WIDTHS,
  MEASURED_GUEST_STORIES,
} from './guest-stories'
import { measurePane } from './pane-metrics'
import { openStory } from './storybook-story'
import { paneViolations } from './verdicts'

/** The width every story's play was written for. */
const STORY_WIDTH = 390
const REDUCED_MOTION_WIDTH = 375

type StorybookIndex = Readonly<{ entries: Readonly<Record<string, StoryIndexEntry>> }>

/**
 * A phone frame is an element with an inline pixel width at least this wide.
 * The stories' stand-ins use inline widths too (a 54 px star), which are
 * content, not frames.
 */
const FRAME_MIN_WIDTH_PX = 300

/**
 * Put every phone frame in the story at `width` and the window to match. A
 * story with no frame (the unavailable page, or a whole page at page height) is
 * already as wide as the window.
 */
async function showAtWidth(page: Page, storyId: string, width: number): Promise<void> {
  await page.setViewportSize({ width: STORY_WIDTH, height: GUEST_VIEWPORT_HEIGHT })
  await openStory(page, storyId)
  await page.setViewportSize({ width, height: GUEST_VIEWPORT_HEIGHT })
  await page.evaluate(
    async ({ frameWidth, minimum }) => {
      const root = document.getElementById('storybook-root')
      for (const element of Array.from(root?.querySelectorAll<HTMLElement>('*') ?? [])) {
        const inline = /^(\d+(?:\.\d+)?)px$/.exec(element.style.width)
        if (inline !== null && Number(inline[1]) >= minimum) {
          element.style.width = `${frameWidth}px`
        }
      }
      // Two frames: the new width has been laid out and painted.
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      )
      await document.fonts.ready
    },
    { frameWidth: width, minimum: FRAME_MIN_WIDTH_PX },
  )
}

test.describe('declared stories', () => {
  // The list in `guest-stories.ts` is hand-written, so it can drift: a renamed
  // story leaves an id that renders Storybook's "no preview" page, and a NEW
  // story is never loaded at all. `story-accounting.ts` holds the rules.
  test('account for every story under src/components/features/guest', async ({
    request,
  }) => {
    const response = await request.get('/index.json')
    expect(response.ok(), `GET /index.json answered ${response.status()}`).toBe(true)
    const index = (await response.json()) as StorybookIndex
    const result = accountForStories({
      entries: Object.values(index.entries),
      importPrefixes: GUEST_STORY_IMPORT_PREFIXES,
      measured: MEASURED_GUEST_STORIES,
      excludedIds: EXCLUDED_GUEST_STORIES,
      excludedTitles: EXCLUDED_GUEST_TITLES,
    })
    expect(result.missing, 'declared in guest-stories.ts but not a guest story').toEqual(
      [],
    )
    expect(
      result.unaccounted,
      'a guest story that is neither measured nor excluded with a reason',
    ).toEqual([])
    expect(result.contradictions, 'declared under an excluded title').toEqual([])
    expect(result.staleExclusions, 'an excluded title with no guest story').toEqual([])
  })
})

for (const width of GUEST_WIDTHS) {
  test.describe(`geometry at ${width} px`, () => {
    for (const storyId of MEASURED_GUEST_STORIES) {
      test(storyId, async ({ page }, testInfo) => {
        await showAtWidth(page, storyId, width)
        const report = await measurePane(page, GUEST_PANE_SELECTOR, {
          hiddenRootBleedIsDecorative: true,
        })
        const lines = paneViolations(
          {
            storyId,
            width,
            paneSelector: GUEST_PANE_SELECTOR,
            requiresPrimary: false,
            judgesTargets: true,
            minimumPx: GUEST_TARGET_MIN_PX,
          },
          report,
        )
        await testInfo.attach('pane-metrics.json', {
          body: JSON.stringify(report, null, 2),
          contentType: 'application/json',
        })
        expect(lines, lines.join('\n')).toEqual([])
      })
    }
  })
}

type MotionFinding = Readonly<{ element: string; what: string }>

/**
 * A duration at or under this is no motion. `src/styles.css` answers
 * `prefers-reduced-motion: reduce` by flooring every transition and animation
 * duration to 0.01 ms (and the iteration count to 1) with `!important`, which
 * is how the app stops motion without enumerating it; the guest page's own
 * `transition: none` rules come on top. 1 ms is a hundred times that floor and
 * far below anything the eye can follow.
 */
const NO_MOTION_SECONDS = 0.001

/**
 * Runs in the iframe. Every element under the story root, and its `::before`
 * and `::after`, whose computed style still asks for a transition or an
 * animation; and every animation the browser reports as running.
 */
function motionInPage(floor: number): ReadonlyArray<MotionFinding> {
  const root = document.getElementById('storybook-root')
  if (root === null) return [{ element: '#storybook-root', what: 'is missing' }]
  const seconds = (list: string): number[] =>
    list.split(',').map((part) => Number.parseFloat(part))
  const describe = (el: Element, pseudo: string): string => {
    const classes = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean)
    return `<${el.tagName.toLowerCase()}${classes.length > 0 ? `.${classes.slice(0, 2).join('.')}` : ''}>${pseudo}`
  }
  const found: MotionFinding[] = []
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const pseudo of ['', '::before', '::after']) {
      const style = getComputedStyle(el, pseudo === '' ? null : pseudo)
      const transitions = seconds(style.transitionDuration)
      const delays = seconds(style.transitionDelay)
      const moves =
        style.transitionProperty !== 'none' &&
        transitions.some((value, index) => value > floor || (delays[index] ?? 0) > floor)
      if (moves) {
        found.push({
          element: describe(el, pseudo),
          what: `transitions ${style.transitionProperty} over ${style.transitionDuration}`,
        })
      }
      const animations = seconds(style.animationDuration)
      if (style.animationName !== 'none' && animations.some((value) => value > floor)) {
        found.push({
          element: describe(el, pseudo),
          what: `animates ${style.animationName} over ${style.animationDuration}`,
        })
      }
    }
  }
  for (const animation of document.getAnimations()) {
    if (animation.playState !== 'running') continue
    const target = (animation.effect as KeyframeEffect | null)?.target
    found.push({
      element: target instanceof Element ? describe(target, '') : '(no target)',
      what: `is running ${animation.constructor.name} ${(animation as CSSAnimation).animationName ?? (animation as CSSTransition).transitionProperty ?? ''}`.trim(),
    })
  }
  return found
}

test.describe(`reduced motion at ${REDUCED_MOTION_WIDTH} px`, () => {
  for (const storyId of MEASURED_GUEST_STORIES) {
    test(storyId, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await showAtWidth(page, storyId, REDUCED_MOTION_WIDTH)
      const findings = await page.evaluate(motionInPage, NO_MOTION_SECONDS)
      const lines = findings.map(
        (finding) =>
          `${storyId}: ${finding.element} ${finding.what} although the guest asked for reduced motion`,
      )
      expect(lines, lines.join('\n')).toEqual([])
    })
  }
})
