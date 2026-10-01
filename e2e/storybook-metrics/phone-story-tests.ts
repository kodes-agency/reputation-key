// The shared shape of a phone-grid test: load one story at one width, measure
// the page, run a check that returns the violations it found, and attach the
// evidence. `inbox-phone.metrics.ts` and `inbox-phone-chrome.metrics.ts` are
// lists of these.
//
// A check returns LINES, never asserts: a red run prints every violation of a
// story at once (with the measured number), not the first one, and the same
// evidence is attached as `phone-grid.json` whether the story passed or not.

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { measurePage, noSidewaysScroll, type PageReport } from './phone-geometry'
import { openStory } from './storybook-story'
import { VIEWPORTS, type StoryWidth } from './story-matrix'

export const PHONES: ReadonlyArray<StoryWidth> = [320, 390]
export const DESKTOP: ReadonlyArray<StoryWidth> = [1440]

/** The widths a test may run at: the harness's three, and 700 for the `sm`..`md` band. */
export type TestWidth = StoryWidth | 700

export type Finding = Readonly<{
  evidence: Readonly<Record<string, unknown>>
  lines: ReadonlyArray<string>
}>
export type Check = (page: Page, view: PageReport, id: string) => Promise<Finding>

async function conclude(
  testInfo: TestInfo,
  story: string,
  width: number,
  view: PageReport,
  finding: Finding,
): Promise<void> {
  const lines = [...noSidewaysScroll(view), ...finding.lines]
  await testInfo.attach('phone-grid.json', {
    body: JSON.stringify(
      { story, width, view, ...finding.evidence, violations: lines },
      null,
      2,
    ),
    contentType: 'application/json',
  })
  expect(
    lines,
    `${lines.length} phone-grid violation(s) in ${story} @ ${width}px`,
  ).toEqual([])
}

/** One test per story per width: load it, measure the page, run the check. */
export function storyTests(
  group: string,
  ids: ReadonlyArray<string>,
  widths: ReadonlyArray<TestWidth>,
  check: Check,
): void {
  test.describe(group, () => {
    for (const width of widths) {
      test.describe(`${width} px`, () => {
        test.use({
          viewport: width === 700 ? { width: 700, height: 900 } : VIEWPORTS[width],
        })
        for (const id of ids) {
          test(id, async ({ page }, testInfo) => {
            await openStory(page, id)
            const view = await measurePage(page)
            await conclude(testInfo, id, width, view, await check(page, view, id))
          })
        }
      })
    }
  })
}
