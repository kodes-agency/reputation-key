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

/**
 * Clear any toasts standing between the pointer and the next control.
 *
 * Sonner stacks its toasts in a `position: fixed` region at the top right, and
 * a spec that performs several mutating actions in a row accumulates them
 * faster than they expire. Playwright then reports the honest but unhelpful
 * "subtree intercepts pointer events" and retries until the test times out —
 * which reads as a dead button rather than as a covered one.
 *
 * Dismissing is deliberate rather than `force: true`: a forced click would also
 * pass if the control were genuinely obscured by a modal or a disabled overlay,
 * which is exactly the failure these specs exist to catch.
 */
const TOAST_DRAIN_TIMEOUT_MS = 10_000

export async function dismissToasts(page: Page): Promise<void> {
  const toasts = page.locator('[data-sonner-toast]')
  // DRAIN, rather than dismiss the number that happened to be present on
  // entry: a mutation that settles mid-loop raises another toast, so a count
  // taken once leaves the last arrival on screen and the final assertion
  // fails. The deadline keeps a page that raises toasts continuously from
  // spinning here instead of failing.
  const deadline = Date.now() + TOAST_DRAIN_TIMEOUT_MS
  while ((await toasts.count()) > 0 && Date.now() < deadline) {
    // Always the first: dismissing re-indexes the list.
    const toast = toasts.first()
    if ((await toast.count()) === 0) break
    await toast.hover().catch(() => undefined)
    const close = toast.getByRole('button', { name: /close|dismiss/i })
    if ((await close.count()) > 0) {
      await close
        .first()
        .click()
        .catch(() => undefined)
    } else {
      await page.keyboard.press('Escape')
    }
    await toast.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
  }
  await expect(toasts).toHaveCount(0, { timeout: TOAST_DRAIN_TIMEOUT_MS })
}
