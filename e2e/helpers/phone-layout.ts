// Layout check a journey applies to a UI state it has opened: on a phone, the
// page does not scroll sideways.

import { expect, type Page } from '@playwright/test'

export const PHONE_VIEWPORT = { width: 390, height: 844 } as const

/** The page is no wider than its window; polled, as late layout can still move it. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true)
}

/**
 * A state, seen on a phone: no sideways scroll. The window goes back to its size
 * afterwards.
 */
export async function expectPhoneLayout(page: Page): Promise<void> {
  const before = page.viewportSize()
  await page.setViewportSize(PHONE_VIEWPORT)
  try {
    await expectNoHorizontalOverflow(page)
  } finally {
    if (before) await page.setViewportSize(before)
  }
}
