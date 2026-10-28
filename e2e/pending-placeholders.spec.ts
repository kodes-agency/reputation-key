// E2E: a slow page shows a placeholder in the page's own frame, and the page
// then arrives where the placeholder stood.
//
// A navigation that takes a moment shows a placeholder (`PageState`, loading). It
// used to be one generic slab: the first block sat 24 px off on every page,
// Settings drew in a wider column than it settles in, and the Portal workspace, a
// full-bleed editor, waited behind a centred column for seconds. A placeholder
// now holds the place of what replaces it, so the title and the first block
// stay put when the page lands.
//
// Every server function is slowed by 1.2 s once the spec starts a hop. The shell's
// own reads come first and a placeholder shows only once the page's loaders run,
// so the page's loaders are what the delay makes visible; it stays on screen for at
// least one more delay, which is far longer than the spec needs to measure it.
import { test, expect } from './helpers/error-detection'
import type { Locator, Page } from '@playwright/test'
import { signIn } from './helpers/auth'
import { requireE2eSeedState } from './helpers/seed-state'

test.use({ viewport: { width: 1440, height: 900 } })
test.setTimeout(60_000)

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

/** The placeholder: a busy region that announces what is loading, present only while a page loads. */
const PLACEHOLDER = '[aria-busy="true"]:has(> .sr-only)'

/** Slow every server function by this much for the rest of the hop. */
const SERVER_FUNCTION_DELAY_MS = 1200
const HOP_TIMEOUT_MS = 20_000

/** Slow the server functions from the moment `start` is called. */
async function slowServerFunctions(page: Page) {
  let slow = false
  await page.route('**/_serverFn/**', async (route) => {
    if (slow)
      await new Promise((resolve) => setTimeout(resolve, SERVER_FUNCTION_DELAY_MS))
    await route.continue()
  })
  return {
    start() {
      slow = true
    },
    stop() {
      slow = false
    },
  }
}

async function boxOf(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error('the element has no box')
  return box
}

/**
 * The title and the block under the header: what a person sees first. The header
 * is the one block that stacks its title, so the block is what follows the element
 * that holds the `h1`'s stack.
 */
async function frameOf(page: Page) {
  const title = page.locator('h1:visible').first()
  const h1 = await boxOf(title)
  const first = title.locator(
    'xpath=ancestor::div[contains(@class, "space-y-3")][1]/following-sibling::*[1]',
  )
  const block = (await first.count()) > 0 ? await boxOf(first) : null
  return { h1, block }
}

type Hop = Readonly<{
  from: string
  /** What a person clicks: a link on the page they are on. */
  link: (page: Page) => Locator
  /** The workspace is a surface of its own: no header block to compare. */
  surface?: boolean
}>

async function expectPlaceholderMatchesPage(page: Page, hop: Hop) {
  const latency = await slowServerFunctions(page)
  await page.goto(hop.from)
  await expect(page.locator('h1:visible').first()).toBeVisible()
  await page.waitForLoadState('networkidle')

  latency.start()
  await hop.link(page).click()
  await expect(page.locator(PLACEHOLDER)).toBeVisible({ timeout: HOP_TIMEOUT_MS })
  const pending = await frameOf(page)

  latency.stop()
  await expect(page.locator(PLACEHOLDER)).toHaveCount(0, { timeout: HOP_TIMEOUT_MS })
  await page.waitForLoadState('networkidle')
  const settled = await frameOf(page)

  const tolerance = hop.surface ? 4 : 2
  expect(Math.abs(pending.h1.x - settled.h1.x)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(pending.h1.y - settled.h1.y)).toBeLessThanOrEqual(tolerance)
  if (hop.surface) return
  if (!pending.block || !settled.block)
    throw new Error('the page has no block under its header')
  expect(Math.abs(pending.block.x - settled.block.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(pending.block.y - settled.block.y)).toBeLessThanOrEqual(8)
  expect(Math.abs(pending.block.width - settled.block.width)).toBeLessThanOrEqual(16)
}

test.describe('Placeholders match the page they stand in for', () => {
  const seed = requireE2eSeedState()
  const property = `/properties/${seed.propertyId}`

  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('properties to the property overview', async ({ page }) => {
    await expectPlaceholderMatchesPage(page, {
      from: '/properties',
      link: (p) => p.locator(`main a[href="${property}"]`).first(),
    })
  })

  test('the property overview to goals', async ({ page }) => {
    await expectPlaceholderMatchesPage(page, {
      from: property,
      link: (p) => p.locator(`a[href^="${property}/goals"]`).first(),
    })
  })

  test('one settings page to the next, in the narrow settings column', async ({
    page,
  }) => {
    await expectPlaceholderMatchesPage(page, {
      from: '/settings/profile',
      link: (p) => p.locator('a[href="/settings/members"]').first(),
    })
  })

  test('the portals list to a portal workspace', async ({ page }) => {
    await expectPlaceholderMatchesPage(page, {
      from: `${property}/portals`,
      link: (p) =>
        p.locator(`main a[href^="${property}/portals/${seed.portalId}"]`).first(),
      surface: true,
    })
  })
})
