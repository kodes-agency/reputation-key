// The two goal rows of the notification settings, against Storybook, where
// Tailwind is compiled (the Vitest story runner compiles none, so "the row fits"
// cannot be read back there; `notifications-settings-page.stories.tsx`
// GoalRowsAt* checks only that both rows and their switches are drawn and
// named). The Goals row split in two on 2026-10-17 (ADR 0046), and "Google
// rating goal" is the longest label a row has had, so a phone is where it would
// push a switch out of the row or the page. Run with
// `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).

import { expect, test, type Page } from '@playwright/test'
import { openStory } from './storybook-story'

// The settings page with every row, inside the story's own 16 px gutter.
const STORY = 'settings-notificationssettingspage--email-allowed'
const ROWS = ['Google rating goal', 'Portal goals'] as const
const SWITCHES = ['In-app', 'Email'] as const

/** The settings row a category's heading names, as the stories find it. */
function rowNamed(page: Page, name: string) {
  return page.locator('fieldset').filter({
    has: page.getByRole('heading', { name, exact: true }),
  })
}

// The story rules' viewports: two phones, a tablet and a desktop.
for (const width of [320, 390, 820, 1440] as const) {
  test(`both goal rows fit a ${width}px window`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openStory(page, STORY)

    for (const name of ROWS) {
      const row = rowNamed(page, name)
      await expect(row).toHaveCount(1)
      const fits = await row.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      )
      expect(fits, `the ${name} row scrolls sideways`).toBe(true)
      const heading = row.getByRole('heading', { name, exact: true })
      const whole = await heading.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      )
      expect(whole, `the ${name} heading is cut off`).toBe(true)
      for (const channel of SWITCHES) {
        const control = row.getByRole('switch', { name: `${name}: ${channel}` })
        await control.scrollIntoViewIfNeeded()
        await expect(control).toBeInViewport({ ratio: 1 })
      }
    }
    const documentScrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(documentScrolls, 'the document scrolls sideways').toBe(false)
  })
}
