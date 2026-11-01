// A tab left open across a deploy.
//
// A deploy replaces the server under an open tab, and from then on the server refuses
// every read the tab makes (src/shared/stale-tab/release-skew.ts). What a person met
// after every deploy, each pinned here:
//
//   (a) Coming back to the tab turned what it showed into "couldn't be loaded". It
//       now loads the current code at once, before any failure is drawn.
//   (b) "Try again" asked for the same refused read again, however often it was
//       pressed, and only a full refresh helped. It now loads the page afresh.
//   (c) None of that may cost what the person typed: coming back leaves the page as
//       it is (the tab reloads on their next navigation, which has unit tests).
//
// The stack serves one release, so the deploy is staged in this browser: until it
// lands the page's head states an older release than the server's, and afterwards
// every read from that release gets the refusal, as the server words it (the server's
// half has its own tests). A page loaded after the deploy states the server's own
// release and is left alone.
//
// Everything waits on a condition (a page load, a refusal, a text); nothing asserts
// on a fixed sleep.

import type { Page } from '@playwright/test'
import { test, expect } from '../helpers/error-detection'
import { signIn } from '../helpers/auth'
import { waitForHydration } from '../helpers/interaction'
import { requireE2eSeedState } from '../helpers/seed-state'
import { FRESH_VIEW_MS } from '../../src/shared/stale-tab/stale-tab'

const seed = requireE2eSeedState()

const OLD_RELEASE = 'a'.repeat(7)
/** The head stating the older release. Hydration adds the server's own beside it, later. */
const OLD_RELEASE_TAG = `meta[name="repkey-release"][content="${OLD_RELEASE}"]`
const RELEASE_HEADER = 'x-repkey-release'
const PORTAL_PAGE = `/properties/${seed.propertyId}/portals/${seed.portalId}`
const PROFILE_PAGE = '/settings/profile'
const PREVIEW_FAILURE = 'The preview couldn’t be loaded.'

/**
 * What the server answers a read from an older release with: HTTP 200, the refusal
 * inside. Recorded from the beta. An upgrade of Start that changes this wire format
 * fails here: send a real read with an old `x-repkey-release` and record it again.
 */
const REFUSAL = String.raw`{"t":10,"i":0,"p":{"k":["result","error","context"],"v":[{"t":2,"s":1},{"t":25,"i":1,"s":{"v":{"t":10,"i":2,"p":{"k":["name","message","code","status"],"v":[{"t":1,"s":"StaleClient"},{"t":1,"s":"Reputation Key was updated while this page was open. Reload to continue."},{"t":1,"s":"stale_client"},{"t":0,"s":409}]},"o":0}},"c":"$TSR/t/repkey:server-function-error"},{"t":10,"i":3,"p":{"k":[],"v":[]},"o":0}]},"o":0}`

/**
 * Open a page as a tab on an older release, and hand back the deploy. Until it
 * lands the release header is taken off every call, so a stack that does have a
 * release of its own does not refuse the tab early.
 */
async function openOnOlderRelease(page: Page, path: string) {
  let deployed = false
  let refusals = 0
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document' || deployed) {
      return route.fallback()
    }
    const response = await route.fetch()
    const body = (await response.text()).replace(
      /(name="repkey-release" content=")[^"]*/u,
      `$1${OLD_RELEASE}`,
    )
    return route.fulfill({ response, body })
  })
  await page.route('**/_serverFn/**', async (route) => {
    const request = route.request()
    const headers = request.headers()
    if (headers[RELEASE_HEADER] !== OLD_RELEASE) return route.fallback()
    if (deployed && request.method() === 'GET') {
      refusals += 1
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'x-tss-serialized': 'true' },
        body: REFUSAL,
      })
    }
    return route.fallback({
      headers: Object.fromEntries(
        Object.entries(headers).filter(([name]) => name !== RELEASE_HEADER),
      ),
    })
  })
  await page.goto(path)
  await waitForHydration(page)
  // The tab starts watching the person once React has taken the page over.
  await page.waitForFunction(() =>
    Object.keys(document.querySelector('main') ?? {}).some((key) =>
      key.startsWith('__reactFiber'),
    ),
  )
  await expect(page.locator(OLD_RELEASE_TAG)).toHaveCount(1)
  // The one wait that is not a condition: a read refused sooner after the page
  // opened reloads it for that reason alone, and proves nothing about what comes next.
  await page.waitForTimeout(FRESH_VIEW_MS)
  return {
    deploy: () => void (deployed = true),
    refusals: () => refusals,
  }
}

/**
 * Go to another tab and back: the browser says so, and the page's reads run again.
 * A read still inside its stale time does not, but the bell's always does (its
 * `staleTime` is 0), so there is a read to refuse however briefly the tab was away.
 */
async function comeBack(page: Page) {
  await page.evaluate(() => {
    const becomes = (visibilityState: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: visibilityState,
      })
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
    }
    becomes('hidden')
    becomes('visible')
  })
}

const nextPageLoad = (page: Page) =>
  page.waitForRequest(
    (request) => request.isNavigationRequest() && request.frame() === page.mainFrame(),
  )

test.describe('a tab left open across a deploy', () => {
  test('coming back to it loads the current code, with no failure on the way', async ({
    page,
  }) => {
    await signIn(page)
    const tab = await openOnOlderRelease(page, PORTAL_PAGE)
    const preview = page.getByRole('region', { name: 'Preview', exact: true })
    await expect(preview).toBeVisible()
    await expect(preview.getByText(PREVIEW_FAILURE)).toHaveCount(0)

    tab.deploy()
    const loaded = nextPageLoad(page)
    await comeBack(page)
    await loaded
    await waitForHydration(page)

    await expect(page.locator(OLD_RELEASE_TAG)).toHaveCount(0)
    await expect(preview).toBeVisible()
    await expect(preview.getByText(PREVIEW_FAILURE)).toHaveCount(0)
  })

  test('Try again on a read the server keeps refusing loads the page afresh', async ({
    page,
  }) => {
    await signIn(page)
    const tab = await openOnOlderRelease(page, PORTAL_PAGE)
    const preview = page.getByRole('region', { name: 'Preview', exact: true })
    await expect(preview).toBeVisible()

    // A read nothing has read yet, with no navigation and no return to the tab to
    // answer for it: the failure is drawn, and only the button is left.
    tab.deploy()
    await preview.getByRole('radio', { name: 'Live' }).click()
    await expect(preview.getByText(PREVIEW_FAILURE)).toBeVisible()

    const loaded = nextPageLoad(page)
    await preview.getByRole('button', { name: 'Try again' }).click()
    await loaded
    await waitForHydration(page)

    await expect(page.locator(OLD_RELEASE_TAG)).toHaveCount(0)
    await expect(preview).toBeVisible()
    await expect(preview.getByText(PREVIEW_FAILURE)).toHaveCount(0)
  })

  test('what the person typed stays through coming back', async ({ page }) => {
    await signIn(page)
    const tab = await openOnOlderRelease(page, PROFILE_PAGE)
    let pageLoads = 0
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        pageLoads += 1
      }
    })
    const field = page.getByLabel('Name', { exact: true })
    await field.fill('Half-written name')

    tab.deploy()
    await comeBack(page)
    // Refused, and refused again on its automatic retry: had either one been going
    // to reload the page, the load would have started by now.
    await expect.poll(tab.refusals).toBeGreaterThanOrEqual(2)

    expect(pageLoads).toBe(0)
    await expect(field).toHaveValue('Half-written name')
  })
})
