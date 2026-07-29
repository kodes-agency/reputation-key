// BQC-6.7 — hydration-safe interaction helpers.
//
// Root-cause class killed here: on cold dev-transform pages the SSR'd form is
// visible (and Playwright-actionable) BEFORE React hydrates. Interacting in
// that window breaks two ways:
//   - click a submit button → NATIVE form submit → full document reload → the
//     client-side mutation never fires and assertions on client state hang;
//   - fill a controlled input → hydration resets it to its initial value →
//     the submit sends empty fields.
//
// The fix at the helper level: after `page.goto`, wait for the network to go
// idle (all vite dev transforms + the React chunk have loaded and hydration
// has run) BEFORE filling or clicking, then assert the target control is
// visible AND enabled (Playwright's actionability covers the rest).
// WebSocket connections (vite HMR) do not count against networkidle.

import { expect, type Locator, type Page } from '@playwright/test'

/** Wait out the pre-hydration window after a document navigation. */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForLoadState('networkidle')
}

/** Hydration-safe click: visible + enabled, then click. */
export async function clickWhenReady(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  await expect(locator).toBeEnabled()
  await locator.click()
}
