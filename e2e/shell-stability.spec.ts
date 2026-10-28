// E2E: the app shell is one stable frame, and the sidebar is the person's.
//
// Three things people see when the shell is wrong, each pinned here:
//
//   (a) Going between a padded page and a full-bleed surface (Overview, Reviews,
//       Portals, a portal's workspace, Goals) used to remount the whole shell and
//       snap the sidebar to another width. The shell's elements must survive every
//       hop, the sidebar and the content edge must hold one position across it, and
//       the hop must not move the layout.
//   (b) On a slow network the old page stays on screen while the next one loads,
//       and the sidebar, the frame and the navigation landmark switched at the
//       click, around the old page. They must keep describing the page on screen
//       until it is replaced.
//   (c) A collapsed sidebar is remembered: the server paints the rail on the next
//       load (no snap), and the trigger and Cmd/Ctrl+B work on the Inbox too.
//
// Everything waits on a condition (a URL, a heading, a width); nothing asserts on a
// fixed sleep. The `error-detection` fixture also fails the test on any console
// error, which is how React reports a hydration mismatch.

import type { Page } from '@playwright/test'
import { test, expect } from './helpers/error-detection'
import { signIn } from './helpers/auth'
import { waitForHydration } from './helpers/interaction'
import { requireE2eSeedState } from './helpers/seed-state'

const WIDE = { width: 1440, height: 900 }
const EXPANDED_PX = 256
const RAIL_PX = 48
/** What one hop may shift, summed over every layout-shift entry (input-flagged too). */
const MAX_SHIFT_PER_HOP = 0.02
/**
 * The portal workspace's placeholder is a padded page-shaped body that gives way to
 * the full-bleed editor, a shift that belongs to the placeholders (the pending
 * state matching its page), not to the frame, which is what this spec pins. It is
 * held to a looser bound here; the acceptance run measures it against its own.
 */
const MAX_SHIFT_INTO_WORKSPACE = 0.06
const SLOW_SERVER_FN_MS = 800

const GAP = '[data-slot="sidebar-gap"]'
const SIDEBAR = '[data-slot="sidebar"]'
const WRAPPER = '[data-slot="sidebar-wrapper"]'
const PARTS = {
  wrapper: WRAPPER,
  container: '[data-slot="sidebar-container"]',
  inset: '[data-slot="sidebar-inset"]',
  header: 'header',
  main: 'main',
} as const

test.use({ viewport: WIDE })

declare global {
  interface Window {
    __shellProbe?: {
      gaps: Set<number>
      mainLeft: Set<number>
      mainWidth: Set<number>
      shift: number
      frames: Array<{
        h1: string | null
        busy: boolean
        frame: string | null
        landmark: string | null
        gap: number
      }>
      firstGap: number | null
    }
  }
}

/**
 * Starts a per-frame probe in the page: the sidebar gap and the content edge on
 * every animation frame, every layout shift, and a snapshot of the frame, the
 * navigation landmark and the heading. Marks the shell's elements so a later
 * remount shows as a lost mark.
 */
async function startProbe(page: Page): Promise<void> {
  await page.evaluate(
    ({ parts, gapSelector, wrapperSelector, sidebarSelector }) => {
      for (const [name, selector] of Object.entries(parts)) {
        const element = document.querySelector<HTMLElement & { __mark?: string }>(
          selector,
        )
        if (element) element.__mark = name
      }
      window.__shellProbe?.frames.splice(0)
      const probe = {
        gaps: new Set<number>(),
        mainLeft: new Set<number>(),
        mainWidth: new Set<number>(),
        shift: 0,
        frames: [] as NonNullable<Window['__shellProbe']>['frames'],
        firstGap: null as number | null,
      }
      window.__shellProbe = probe
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          probe.shift += (entry as unknown as { value: number }).value
        }
      }).observe({ type: 'layout-shift', buffered: false })
      const tick = () => {
        const gap = document.querySelector(gapSelector)
        const main = document.querySelector('main')
        if (gap && main) {
          const gapWidth = Math.round(gap.getBoundingClientRect().width)
          const box = main.getBoundingClientRect()
          probe.gaps.add(gapWidth)
          probe.mainLeft.add(Math.round(box.left))
          probe.mainWidth.add(Math.round(box.width))
          probe.frames.push({
            h1: document.querySelector('h1')?.textContent ?? null,
            busy: document.querySelector('[aria-busy="true"]') !== null,
            frame:
              document.querySelector(wrapperSelector)?.getAttribute('data-frame') ?? null,
            landmark:
              document
                .querySelector(`${sidebarSelector} nav`)
                ?.getAttribute('aria-label') ?? null,
            gap: gapWidth,
          })
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    {
      parts: PARTS,
      gapSelector: GAP,
      wrapperSelector: WRAPPER,
      sidebarSelector: SIDEBAR,
    },
  )
}

async function survivors(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate((parts) => {
    return Object.fromEntries(
      Object.entries(parts).map(([name, selector]) => [
        name,
        (document.querySelector(selector) as { __mark?: string } | null)?.__mark === name,
      ]),
    )
  }, PARTS)
}

/** Resets what the probe has counted, at the start of a hop. */
async function resetProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = window.__shellProbe
    if (!probe) throw new Error('the probe is not running')
    probe.gaps.clear()
    probe.mainLeft.clear()
    probe.mainWidth.clear()
    probe.shift = 0
    probe.frames.splice(0)
  })
}

async function headingText(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector('h1')?.textContent ?? null)
}

/** The page has settled: fonts are in, nothing is busy, and two frames have gone by. */
async function untilSettled(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    )
  })
}

test.describe('Shell stability', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('one shell survives every hop between pages and full-bleed surfaces', async ({
    page,
  }) => {
    const seed = requireE2eSeedState()
    const nav = page.getByRole('navigation', { name: 'Primary navigation' })
    await page.goto(`/properties/${seed.propertyId}`)
    await waitForHydration(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
    await untilSettled(page)
    await startProbe(page)

    const hops: ReadonlyArray<{
      name: string
      go: () => Promise<void>
      url: RegExp
      frame: 'page' | 'surface'
      maxShift?: number
    }> = [
      {
        name: 'Overview to Reviews',
        go: () => nav.getByRole('link', { name: 'Reviews', exact: true }).click(),
        url: /\/reviews(?:\?|$)/,
        frame: 'surface',
      },
      {
        name: 'Reviews to Portals',
        go: () => nav.getByRole('link', { name: 'Portals', exact: true }).click(),
        url: /\/portals(?:\?|$)/,
        frame: 'page',
      },
      {
        name: 'Portals to a portal',
        go: () =>
          page.locator(`main a[href*="/portals/${seed.portalId}"]`).first().click(),
        url: /\/portals\/[0-9a-f-]{36}/,
        frame: 'surface',
        maxShift: MAX_SHIFT_INTO_WORKSPACE,
      },
      {
        name: 'a portal to Goals',
        go: () => nav.getByRole('link', { name: 'Goals', exact: true }).click(),
        url: /\/goals(?:\?|$)/,
        frame: 'page',
      },
    ]

    for (const hop of hops) {
      const before = await headingText(page)
      await resetProbe(page)
      await hop.go()
      await expect(page).toHaveURL(hop.url)
      await expect.poll(() => headingText(page), { message: hop.name }).not.toBe(before)
      await untilSettled(page)

      expect(await survivors(page), `${hop.name}: the shell was remounted`).toEqual({
        wrapper: true,
        container: true,
        inset: true,
        header: true,
        main: true,
      })
      const probe = await page.evaluate(() => {
        const p = window.__shellProbe
        return p
          ? {
              gaps: [...p.gaps],
              mainLeft: [...p.mainLeft],
              mainWidth: [...p.mainWidth],
              shift: p.shift,
            }
          : null
      })
      expect(probe?.gaps, `${hop.name}: the sidebar changed width`).toEqual([EXPANDED_PX])
      expect(probe?.mainLeft, `${hop.name}: the content edge moved`).toEqual([
        EXPANDED_PX,
      ])
      expect(probe?.mainWidth, `${hop.name}: the content width changed`).toHaveLength(1)
      expect(probe?.shift ?? 1, `${hop.name}: layout shift`).toBeLessThanOrEqual(
        hop.maxShift ?? MAX_SHIFT_PER_HOP,
      )
      // The frame is the page's: padded, or the full-bleed surface's.
      await expect(page.locator(WRAPPER)).toHaveAttribute('data-frame', hop.frame)
    }
  })

  test('on a slow network the sidebar and frame keep describing the page on screen', async ({
    page,
  }) => {
    const seed = requireE2eSeedState()

    async function slowHop(
      go: () => Promise<void>,
      url: RegExp,
    ): Promise<{
      old: string | null
      oldFrame: string | null
      oldLandmark: string | null
    }> {
      await untilSettled(page)
      const old = await headingText(page)
      const oldFrame = await page.locator(WRAPPER).getAttribute('data-frame')
      const oldLandmark = await page.locator(`${SIDEBAR} nav`).getAttribute('aria-label')
      await resetProbe(page)
      await page.route('**/_serverFn/**', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, SLOW_SERVER_FN_MS))
        await route.continue()
      })
      await go()
      await expect(page).toHaveURL(url)
      await expect.poll(() => headingText(page)).not.toBe(old)
      await page.unroute('**/_serverFn/**')
      return { old, oldFrame, oldLandmark }
    }

    async function onlyTheOldPageWasFramedAsOld(
      old: string | null,
      oldFrame: string | null,
      oldLandmark: string | null,
      width: number,
    ): Promise<void> {
      const frames = await page.evaluate(() => window.__shellProbe?.frames ?? [])
      const onScreenOld = frames.filter((f) => f.h1 === old && !f.busy)
      // Not vacuous: the old page really was on screen while the next one loaded.
      expect(onScreenOld.length).toBeGreaterThan(0)
      for (const frame of onScreenOld) {
        expect(frame).toMatchObject({
          frame: oldFrame,
          landmark: oldLandmark,
          gap: width,
        })
      }
    }

    // Staff to Settings: the sidebar swaps from the app's to Settings'.
    await page.goto(`/properties/${seed.propertyId}/people`)
    await waitForHydration(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible()
    await startProbe(page)
    const toSettings = await slowHop(
      () =>
        page
          .locator('[data-slot="sidebar-container"] a[href="/settings/profile"]')
          .click(),
      /\/settings\/profile$/,
    )
    await onlyTheOldPageWasFramedAsOld(
      toSettings.old,
      toSettings.oldFrame,
      toSettings.oldLandmark,
      EXPANDED_PX,
    )
    await expect(
      page.getByRole('navigation', { name: 'Settings navigation' }),
    ).toBeVisible()

    // Portals to a portal's workspace: the frame swaps from padded to full-bleed.
    await page.goto(`/properties/${seed.propertyId}/portals`)
    await waitForHydration(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Portals' })).toBeVisible()
    await startProbe(page)
    const toWorkspace = await slowHop(
      () => page.locator(`main a[href*="/portals/${seed.portalId}"]`).first().click(),
      /\/portals\/[0-9a-f-]{36}/,
    )
    await onlyTheOldPageWasFramedAsOld(
      toWorkspace.old,
      toWorkspace.oldFrame,
      toWorkspace.oldLandmark,
      EXPANDED_PX,
    )
    await expect(page.locator(WRAPPER)).toHaveAttribute('data-frame', 'surface')
  })

  test('the top bar and section navigation stay visible on a long padded page', async ({
    page,
  }) => {
    const seed = requireE2eSeedState()
    await page.goto(`/properties/${seed.propertyId}/settings/replies`)
    await waitForHydration(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Replies' })).toBeVisible()
    await untilSettled(page)

    const topBar = page.locator('[data-slot="sidebar-inset"] > header')
    const sectionNav = page.getByRole('navigation', {
      name: 'Property settings sections',
    })
    await expect(topBar).toBeVisible()
    await expect(sectionNav).toBeVisible()

    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
      )
      .toBeGreaterThanOrEqual(800)
    await page.evaluate(() => window.scrollTo(0, 800))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(800)

    await expect
      .poll(() =>
        topBar.evaluate((element) => Math.round(element.getBoundingClientRect().top)),
      )
      .toBe(0)
    const barBottom = await topBar.evaluate((element) =>
      Math.round(element.getBoundingClientRect().bottom),
    )
    await expect
      .poll(() =>
        sectionNav.evaluate((element) => Math.round(element.getBoundingClientRect().top)),
      )
      .toBe(barBottom)
  })

  test('a collapsed sidebar is remembered, and the controls work on the Inbox', async ({
    page,
  }) => {
    const seed = requireE2eSeedState()
    // The first width the sidebar is ever drawn at in a document: what the server
    // painted, before any script could have changed it.
    await page.addInitScript(
      ({ gapSelector }) => {
        const look = () => {
          const gap = document.querySelector(gapSelector)
          if (!gap) return requestAnimationFrame(look)
          ;(window as unknown as { __firstGap?: number }).__firstGap = Math.round(
            gap.getBoundingClientRect().width,
          )
          return undefined
        }
        requestAnimationFrame(look)
      },
      { gapSelector: GAP },
    )
    const firstGap = () =>
      page.evaluate(() => (window as unknown as { __firstGap?: number }).__firstGap)

    await page.goto(`/properties/${seed.propertyId}`)
    await waitForHydration(page)
    await expect.poll(firstGap).toBe(EXPANDED_PX)

    await page.locator('[data-slot="sidebar-trigger"]').click()
    await expect(page.locator(`${SIDEBAR}[data-state="collapsed"]`)).toBeVisible()
    await expect
      .poll(
        async () =>
          (await page.context().cookies()).find((c) => c.name === 'sidebar_state')?.value,
      )
      .toBe('false')

    // The server reads the choice: its HTML is already the rail.
    const html = await (await page.request.get('/properties')).text()
    expect(
      html.includes('data-state="collapsed"'),
      'the server HTML is the collapsed rail',
    ).toBe(true)

    await page.reload()
    await waitForHydration(page)
    await expect.poll(firstGap).toBe(RAIL_PX)

    // The Inbox: the same state, with the trigger and the shortcut live.
    await page.goto('/inbox')
    await waitForHydration(page)
    await expect(page.locator(`${SIDEBAR}[data-state="collapsed"]`)).toBeVisible()
    await page.keyboard.press('ControlOrMeta+b')
    await expect(page.locator(`${SIDEBAR}[data-state="expanded"]`)).toBeVisible()
    await expect
      .poll(
        async () =>
          (await page.context().cookies()).find((c) => c.name === 'sidebar_state')?.value,
      )
      .toBe('true')

    await page.reload()
    await waitForHydration(page)
    await expect.poll(firstGap).toBe(EXPANDED_PX)
    await expect(page.locator('[data-inbox-queue-rail]')).toBeVisible()

    // Leaving the Inbox does not change the width it was left at.
    await page.goto(`/properties/${seed.propertyId}`)
    await waitForHydration(page)
    await expect(page.locator(`${SIDEBAR}[data-state="expanded"]`)).toBeVisible()
  })
})
