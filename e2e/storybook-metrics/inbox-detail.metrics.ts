// Inbox detail pane — the committed real-browser metrics gate (plan v2.1 row
// 20, PR 5). Run with `pnpm test:storybook:metrics`. It is NOT in CI yet —
// see `playwright.storybook.config.ts`, "CI", for why and what that leaves open.
//
// For every story declared in `inbox-detail-stories.ts`, at the widths that
// story's pane was drawn for, against Storybook with Tailwind compiled:
//
//   1. every interactive element in the pane has a smaller side of >= 36 px
//      below 768 and >= 24 px at 1440; a menu or select row and the collapsed
//      pill >= 44 px below 768;
//   2. neither the pane nor any scroller inside it overflows, no shown element
//      reaches past the box that clips it, the pane fits the window, and the
//      document does not scroll sideways;
//   3. every region-4 primary on screen (`Submit for approval` / `Submit` /
//      `Add note`, and `Review update` / `Mark as handled` / `Correct
//      outcome`) is inside the viewport and hit-testable, and the stories
//      declared `withPrimary` must show one;
//   4. every layer the pane can open — each menu, popover, select and dialog
//      trigger, opened one at a time by `layer-probe.ts` — fits the viewport,
//      does not overflow or clip, and its rows meet rule 1;
//   5. rules 1-4 again with every closed disclosure in the pane opened (a
//      fold, a `<details>`, the collapsed composer's bar), because a play that
//      opens a state and closes it again leaves only the closed one on screen.
//
// A red run prints one line per violation — story id, width, stage, the
// element's accessible name and its measured box — and attaches every
// measurement as `pane-metrics.json`, collected in
// `test-results/storybook-metrics/report.json`.
//
// ── Order, and why ──────────────────────────────────────────────────────────
//
// The final frame is measured AND judged before anything is clicked, and its
// lines are attached at once (`final-frame.json`). Review found the first
// harness judged only after opening every menu, so an overflow that put the
// reply-due detail over the owner trigger printed nothing but a 90 s click
// timeout. Driving the pane (rules 4 and 5) can only ADD lines now; it cannot
// take the ones already found away.
//
// ── Where this file lives, and why not where the plan put it ────────────────
//
// Plan v2.1's PR 5 names `e2e/tooling/inbox-detail-metrics.spec.ts`. That path
// would break every full e2e run: `playwright.config.ts` has `testDir:
// './e2e'` and its `full` project matches `/^(?!.*\/critical\/).*\.spec\.ts$/`
// against the APP on :3000, so any `*.spec.ts` under `e2e/` outside
// `critical/` is swept in — and this file needs Storybook, which that run
// never starts. It lives in `e2e/storybook-metrics/` as `*.metrics.ts`
// instead, owned by `playwright.storybook.config.ts` alone, and is still
// type-checked (`tsconfig.json` includes `e2e/**/*.ts`).
//
// ── What this cannot see ────────────────────────────────────────────────────
//
// Stories, not the page: a composition only `inbox-page-v2.tsx` produces is
// the e2e suite's. Chromium only: WebKit and Firefox are not run, although
// row 14's PR 4 figures were taken in both Chromium and WebKit by hand. A
// dialog opened from a MENU ROW (the closed status's `Reopen`) is not opened:
// the harness opens triggers, never the actions inside a layer.

import { expect, test } from '@playwright/test'
import { EXCLUDED_STORIES, EXCLUDED_TITLES } from './inbox-detail-exclusions'
import {
  DECLARATION_ERRORS,
  INBOX_STORY_IMPORT_PREFIX,
  MEASURED_STORIES,
  VIEWPORTS,
  type MeasuredStory,
  type StoryWidth,
} from './inbox-detail-stories'
import { expandDisclosures, probeLayers } from './layer-probe'
import { measurePane } from './pane-metrics'
import { openStory } from './storybook-story'
import {
  expansionViolations,
  onlyNew,
  paneViolations,
  probeViolations,
  type Expectations,
} from './verdicts'

const WIDTHS: ReadonlyArray<StoryWidth> = [320, 390, 1440]
const WORKSPACE_METRIC_TITLES = new Set([
  'Inbox/Bulk Actions',
  'Inbox/Filter Popover',
  'Inbox/Item List',
  'Inbox/Visit Badge',
  'Inbox/List Header',
  'Inbox/Queue Rail',
])
const LIST_STORIES = [
  'default',
  'awaiting-approval-reply',
  'waiting-for-google-reply',
  'needs-check-reply',
  'not-published-reply',
  'with-selection',
  'active-review',
  'selection-limit',
  'select-row',
  'open-row',
] as const
const HEADER_STORIES = ['resting', 'filtered', 'searching', 'all-properties'] as const
const RAIL_STORIES = ['manager', 'member', 'zero-counts'] as const

/**
 * Driving the pane stops this long before the test's own timeout, and says
 * so, so the lines already found are always printed.
 */
const EVIDENCE_MARGIN_MS = 20_000

type IndexEntry = Readonly<{
  id: string
  type: string
  title: string
  importPath: string
}>
type StorybookIndex = Readonly<{ entries: Readonly<Record<string, IndexEntry>> }>

test.describe('declared stories', () => {
  // The matrix is hand-written, so it can drift from the stories, and every
  // drift would be silent: a renamed story leaves an id that renders
  // Storybook's "no preview" page, and a NEW story is never loaded at all.
  //
  // What counts as "an inbox story" is WHERE IT IS DEFINED, not its id. The
  // first version checked only ids under the prefixes it already measured, so
  // review added `Inbox/Owner Control` (a 20 px trigger in a `Case status`
  // section) under `src/components/inbox/`; `/index.json` listed it, this test
  // stayed green and the harness generated 0 tests for it — and 160 stories
  // across 16 existing titles had never been measured. Now every story whose
  // file is under `src/components/inbox/` is measured, excluded by id with a
  // reason, or belongs to a title excluded with a reason.
  test('account for every story under src/components/inbox', async ({ request }) => {
    const response = await request.get('/index.json')
    expect(response.ok(), `GET /index.json answered ${response.status()}`).toBe(true)
    const index = (await response.json()) as StorybookIndex
    const inbox = Object.values(index.entries).filter(
      (entry) =>
        entry.type === 'story' && entry.importPath.startsWith(INBOX_STORY_IMPORT_PREFIX),
    )
    const titleOf = new Map(inbox.map((entry) => [entry.id, entry.title]))
    const measured = new Set(MEASURED_STORIES.map((story) => story.id))
    const declared = new Set([...measured, ...Object.keys(EXCLUDED_STORIES)])

    // Against the INBOX stories, not all of them: if `importPath` ever changes
    // shape, `inbox` is empty and every declared id lands here, loudly.
    const missing = [...declared].filter((id) => !titleOf.has(id))
    const unaccounted = inbox
      .filter(
        (entry) =>
          !declared.has(entry.id) &&
          !(entry.title in EXCLUDED_TITLES) &&
          !WORKSPACE_METRIC_TITLES.has(entry.title),
      )
      .map((entry) => `${entry.id} (${entry.title}, ${entry.importPath})`)
    const contradictions = [...declared]
      .filter((id) => (titleOf.get(id) ?? '') in EXCLUDED_TITLES)
      .map(
        (id) =>
          `${id} is declared, but its title "${titleOf.get(id)}" is EXCLUDED_TITLES`,
      )
    const staleTitles = Object.keys(EXCLUDED_TITLES).filter(
      (title) => !inbox.some((entry) => entry.title === title),
    )

    expect(DECLARATION_ERRORS, 'inbox-detail-stories.ts contradicts itself').toEqual([])
    expect(contradictions, 'measured or excluded by id under an excluded title').toEqual(
      [],
    )
    expect(missing, 'declared in inbox-detail-stories.ts but not an inbox story').toEqual(
      [],
    )
    expect(staleTitles, 'EXCLUDED_TITLES names a title with no inbox story').toEqual([])
    expect(
      unaccounted,
      'an inbox story that is neither measured nor EXCLUDED with a reason',
    ).toEqual([])
  })
})

test.describe('workspace list geometry', () => {
  for (const width of WIDTHS) {
    test.describe(`${width} px`, () => {
      test.use({ viewport: VIEWPORTS[width] })

      for (const story of LIST_STORIES) {
        test(`inbox-item-list--${story} keeps 78 px rows`, async ({ page }) => {
          await openStory(page, `inbox-item-list--${story}`)
          const heights = await page
            .locator('[data-inbox-list-row]')
            .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height))
          expect(heights.length).toBeGreaterThan(0)
          expect(heights).toEqual(heights.map(() => 78))
        })
      }

      for (const story of HEADER_STORIES) {
        test(`inbox-list-header--${story} keeps its header height`, async ({ page }) => {
          await openStory(page, `inbox-list-header--${story}`)
          const height = await page
            .locator('[data-inbox-list-header]')
            .evaluate((header) => header.getBoundingClientRect().height)
          expect(height).toBe(width < 768 ? 44 : 56)
        })
      }
    })
  }

  for (const story of RAIL_STORIES) {
    test(`inbox-queue-rail--${story} keeps the 224 px rail`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[1440])
      await openStory(page, `inbox-queue-rail--${story}`)
      const width = await page
        .locator('[data-inbox-queue-rail]')
        .evaluate((rail) => rail.getBoundingClientRect().width)
      expect(width).toBe(224)
    })
  }
})

function expectationsFor(story: MeasuredStory, width: number): Expectations {
  return {
    storyId: story.id,
    width,
    paneSelector: story.pane,
    requiresPrimary: story.requiresPrimary,
    judgesTargets: story.judgesTargets,
  }
}

for (const width of WIDTHS) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: VIEWPORTS[width] })

    for (const story of MEASURED_STORIES.filter((s) => s.widths.includes(width))) {
      test(story.id, async ({ page }, testInfo) => {
        const expectations = expectationsFor(story, width)
        const deadline = Date.now() + testInfo.timeout - EVIDENCE_MARGIN_MS
        await openStory(page, story.id)

        // Rules 1-3 on the play's final frame, judged and attached before the
        // harness touches anything.
        const pane = await measurePane(page, story.pane)
        const finalFrame = paneViolations(expectations, pane)
        await testInfo.attach('final-frame.json', {
          body: JSON.stringify({ story, width, pane, violations: finalFrame }, null, 2),
          contentType: 'application/json',
        })
        // Rebuilt, never mutated, as each stage lands, so the `finally` below
        // attaches exactly what was found up to a harness failure.
        let run: Readonly<{
          evidence: Readonly<Record<string, unknown>>
          lines: ReadonlyArray<string>
        }> = {
          evidence: { story, width, pane },
          lines: finalFrame,
        }
        const record = (
          evidence: Record<string, unknown>,
          lines: ReadonlyArray<string>,
        ) => {
          run = {
            evidence: { ...run.evidence, ...evidence },
            lines: [...run.lines, ...lines],
          }
        }
        try {
          if (pane.paneCount > 0) {
            // Rule 4.
            const probes = await probeLayers(page, story.pane, deadline)
            record({ probes }, probeViolations(expectations, pane.viewport, probes))

            // Rule 5: the same pane with its disclosures open, and whatever
            // triggers only that state shows.
            const expansion = await expandDisclosures(page, story.pane, deadline)
            record({ expansion }, expansionViolations(expectations, expansion))
            if (expansion.expanded.length > 0) {
              const stage = `with ${expansion.expanded.map((name) => `"${name}"`).join(', ')} opened: `
              const opened = await measurePane(page, story.pane)
              const openedProbes = await probeLayers(page, story.pane, deadline)
              const openedExpectations: Expectations = {
                ...expectations,
                // Presence of the primary is judged once, on the story's own
                // state; its position is judged wherever it shows.
                requiresPrimary: false,
                judgesTargets: story.judgesOpenedTargets,
              }
              const openedLines = [
                ...paneViolations(openedExpectations, opened, stage),
                ...probeViolations(
                  openedExpectations,
                  opened.viewport,
                  openedProbes,
                  stage,
                ),
              ]
              record(
                { opened: { pane: opened, probes: openedProbes } },
                onlyNew(openedLines, run.lines, stage),
              )
            }
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          record({}, [
            `${story.id} @ ${width}px: the harness could not finish: ${message}`,
          ])
        } finally {
          await testInfo.attach('pane-metrics.json', {
            body: JSON.stringify({ ...run.evidence, violations: run.lines }, null, 2),
            contentType: 'application/json',
          })
        }
        const { lines } = run
        expect(lines, `${lines.length} geometry violation(s)`).toEqual([])
      })
    }
  })
}
