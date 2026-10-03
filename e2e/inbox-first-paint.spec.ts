// E2E: the Inbox's server render is its first paint on a hard load. On a phone
// it must already be the compact composition (queue strip above the list), not
// the desktop queue rail that hydration used to swap out a moment later. The
// server picks the layout from the width cookie the app writes, or from the
// user agent on a first visit (src/components/hooks/viewport-hint.ts).
//
// The checked browser contexts run with JavaScript off, so what they show is
// exactly what paints before hydration. The hard load with JavaScript on checks
// that hydration agrees with it: the harness fails a test on any console or
// page error, and React reports a hydration mismatch as one.

import { devices, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { test, expect } from './helpers/error-detection'
import { signIn } from './helpers/auth'

const PHONE = devices['iPhone 13']
const DESKTOP_VIEWPORT = { width: 1440, height: 900 }
const VIEWPORT_COOKIE = 'rk_viewport'

type ServerPaint = Readonly<{
  viewport: { width: number; height: number }
  userAgent?: string
  isMobile?: boolean
  /** A browser that has never opened the app has no width cookie yet. */
  firstVisit?: boolean
}>

/** A JavaScript-free copy of `page`'s signed-in browser, looking at /inbox. */
async function openServerPaint(
  browser: Browser,
  page: Page,
  { firstVisit = false, ...options }: ServerPaint,
): Promise<{ context: BrowserContext; inbox: Page }> {
  const state = await page.context().storageState()
  const context = await browser.newContext({
    ...options,
    javaScriptEnabled: false,
    storageState: firstVisit ? withoutViewportCookie(state) : state,
  })
  const inbox = await context.newPage()
  await inbox.goto(new URL('/inbox', page.url()).href)
  await expect(inbox.locator('[data-inbox-list-header]')).toBeVisible()
  return { context, inbox }
}

function queueRail(inbox: Page) {
  return inbox.locator('[data-inbox-queue-rail]')
}

function withoutViewportCookie(
  state: Awaited<ReturnType<BrowserContext['storageState']>>,
) {
  return {
    ...state,
    cookies: state.cookies.filter((cookie) => cookie.name !== VIEWPORT_COOKIE),
  }
}

test.describe('Inbox first paint', () => {
  test('a phone that has opened the app paints the queue strip, not the rail', async ({
    browser,
    page,
  }) => {
    await page.setViewportSize(PHONE.viewport)
    await signIn(page)
    await expect
      .poll(async () =>
        (await page.context().cookies()).find((c) => c.name === VIEWPORT_COOKIE),
      )
      .toMatchObject({ value: String(PHONE.viewport.width) })

    const { context, inbox } = await openServerPaint(browser, page, {
      viewport: PHONE.viewport,
    })
    await expect(queueRail(inbox)).toHaveCount(0)
    await expect(inbox.getByRole('navigation', { name: 'Queues' })).toBeVisible()
    await context.close()

    await page.goto('/inbox')
    await expect(page.locator('[data-inbox-list-header]')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(queueRail(page)).toHaveCount(0)
  })

  test('a Chromium phone on its first visit is recognised by its client hint', async ({
    browser,
    page,
  }) => {
    await signIn(page)

    // `isMobile` makes Chromium send `Sec-CH-UA-Mobile: ?1`.
    const { context, inbox } = await openServerPaint(browser, page, {
      viewport: PHONE.viewport,
      userAgent: PHONE.userAgent,
      isMobile: true,
      firstVisit: true,
    })
    await expect(queueRail(inbox)).toHaveCount(0)
    await context.close()
  })

  test('a Safari phone on its first visit is recognised by its user agent', async ({
    playwright,
    page,
  }) => {
    await signIn(page)

    // Safari sends no client hints, and Chromium always does, so the request
    // goes through the API client: it sends exactly the headers given here.
    const safari = await playwright.request.newContext({
      storageState: withoutViewportCookie(await page.context().storageState()),
      extraHTTPHeaders: { 'user-agent': PHONE.userAgent },
    })
    const response = await safari.get(new URL('/inbox', page.url()).href)
    expect(response.ok()).toBe(true)
    const html = await response.text()
    expect(html).toContain('data-inbox-list-header')
    expect(html).not.toContain('data-inbox-queue-rail')
    await safari.dispose()
  })

  test('a desktop still paints the queue rail', async ({ browser, page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await signIn(page)

    const { context, inbox } = await openServerPaint(browser, page, {
      viewport: DESKTOP_VIEWPORT,
    })
    await expect(queueRail(inbox)).toBeVisible()
    await context.close()
  })
})
