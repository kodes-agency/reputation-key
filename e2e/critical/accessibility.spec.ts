// BQC-6.8 — accessibility, theme, responsive, and reduced-motion gate.
//
// The page-level complement to the Storybook a11y gate: axe-core (same version
// as the storybook addon, resolved through its dependency chain) runs against
// the ENABLED workflow pages in the permissive posture (signed-in owner). On
// real pages the page-structure rules the storybook preview disables
// (landmark-one-main, page-has-heading-one, region, landmark-*) APPLY, so this
// layer runs axe's full default rule set — suppressions only through the
// narrow register in e2e/helpers/a11y.ts.
//
// Also covered here (one spec, one sign-in pattern):
//   - light-theme axe re-scan (theme toggle path) — dark is the default
//   - keyboard: inbox j/k/Enter/Escape, tab order + visible focus indicator,
//     Radix dialog focus trap / Escape / focus return
//   - reduced motion: the global prefers-reduced-motion rule zeroes computed
//     transition/animation durations
//   - zoom reflow: 200%/400% body zoom → no horizontal scrollbar
//   - mobile viewport (390×844): inbox rows full-width, nav collapses to the
//     drawer pattern
//
// Registered as unsupported-by-design (no code, see slice report):
//   high-contrast (no forced-colors support), RTL, 44px touch-target
//   convention (design-system decision — button heights are 36/32px).
//
// IBX-01-T9 — every Inbox item seeded here is scanned THROUGH the product (the
// list rows, the detail panel, the keyboard journey), so all of them use
// `seedReviewInboxItemWithCycle`. Serving reads resolve status from the
// Handling Cycle head, so a bare `inbox_items` row renders nothing and the axe
// scans would pass against an empty list rather than the intended surface.

import { test, expect } from '../helpers/error-detection'
import { signIn } from '../helpers/auth'
import { requireE2eSeedState } from '../helpers/seed-state'
import { assertNoAxeViolations } from '../helpers/a11y'
import { waitForHydration } from '../helpers/interaction'
import {
  e2eRunId,
  cleanupE2eData,
  seedProperty,
  seedReview,
  seedReviewInboxItemWithCycle,
} from '../helpers/fixtures'

const PREFIX = 'e2e-a11y-'
const seed = requireE2eSeedState()

test.describe('Critical a11y: axe page scans', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('fleet dashboard (/dashboard, 2 properties) is axe-clean', async ({ page }) => {
    // The fleet view only renders with 2+ properties (1 → deep-dive redirect).
    // Grant the seeded manager access explicitly: these tests assert on fleet
    // CONTENT, and property_access_grant is the sole scope source. Without the
    // grant the row is only visible because the seeded role happens to resolve
    // organization-wide.
    await seedProperty({
      organizationId: seed.organizationId,
      name: 'A11y Fleet Annex',
      slug: `${PREFIX}fleet-annex-${e2eRunId}`,
      grantAccessToUserId: seed.managerUserId,
    })
    await signIn(page)
    await page.goto('/dashboard')
    await expect(page.getByText('Needs attention')).toBeVisible({ timeout: 15_000 })
    await assertNoAxeViolations(page, 'fleet dashboard (/dashboard)')
  })

  test('fleet dashboard in LIGHT theme is axe-clean', async ({ page }) => {
    await seedProperty({
      organizationId: seed.organizationId,
      name: 'A11y Fleet Annex',
      slug: `${PREFIX}fleet-annex-${e2eRunId}`,
      grantAccessToUserId: seed.managerUserId,
    })
    // Exercise the real theme-init path: THEME_INIT_SCRIPT reads localStorage
    // 'theme' before first paint.
    await page.addInitScript(() => {
      window.localStorage.setItem('theme', 'light')
    })
    await signIn(page)
    await page.goto('/dashboard')
    await expect(page.getByText('Needs attention')).toBeVisible({ timeout: 15_000 })
    // Light theme actually applied (not .dark).
    const themeState = await page.evaluate(() => ({
      isDark: document.documentElement.classList.contains('dark'),
      colorScheme: document.documentElement.style.colorScheme,
    }))
    expect(themeState).toEqual({ isDark: false, colorScheme: 'light' })
    await assertNoAxeViolations(page, 'fleet dashboard (/dashboard, light theme)')
  })

  test('property deep-dive (/properties/$id) is axe-clean', async ({ page }) => {
    await signIn(page)
    await page.goto(`/properties/${seed.propertyId}`)
    await expect(page.getByText(seed.propertyName).first()).toBeVisible({
      timeout: 15_000,
    })
    await assertNoAxeViolations(page, 'property deep-dive (/properties/$id)')
  })

  test('inbox list (/inbox) is axe-clean', async ({ page }) => {
    const { reviewId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      externalId: `${PREFIX}scan-list-${e2eRunId}`,
      rating: 4,
      text: 'List scan review body.',
      reviewerName: 'Scan Reviewer',
    })
    await seedReviewInboxItemWithCycle({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      reviewId,
    })
    await signIn(page)
    await page.goto('/inbox')
    await expect(page.getByText('Scan Reviewer').first()).toBeVisible({ timeout: 15_000 })
    await assertNoAxeViolations(page, 'inbox list (/inbox)')
  })

  test('inbox with item detail open (/inbox?itemId=) is axe-clean', async ({ page }) => {
    const { reviewId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      externalId: `${PREFIX}scan-detail-${e2eRunId}`,
      rating: 2,
      text: 'Detail scan review body — the room was noisy overnight.',
      reviewerName: 'Detail Reviewer',
    })
    const { inboxItemId } = await seedReviewInboxItemWithCycle({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      reviewId,
    })
    await signIn(page)
    await page.goto(`/inbox?itemId=${inboxItemId}`)
    await expect(page.getByText('Detail Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })
    // Detail actions rendered (the detail panel, not just the list). The
    // control is labelled "Close detail" -- an exact match on "Close" silently
    // stopped matching it and no longer proved the panel was open.
    await expect(
      page.getByRole('button', { name: 'Close detail', exact: true }).first(),
    ).toBeVisible()
    await assertNoAxeViolations(page, 'inbox detail (/inbox?itemId=)')
  })

  test('property people page (/properties/$id/people) is axe-clean', async ({ page }) => {
    await signIn(page)
    await page.goto(`/properties/${seed.propertyId}/people`)
    await expect(page).toHaveURL(new RegExp(`/properties/${seed.propertyId}/people`))
    // Wait for real page content (the h1), not just the shell — scanning during
    // the loader pending window would flag the missing h1 spuriously.
    await expect(page.getByRole('heading', { name: /^people$/i }).first()).toBeVisible({
      timeout: 15_000,
    })
    await assertNoAxeViolations(page, 'property people (/properties/$id/people)')
  })

  test('settings members (/settings/members) is axe-clean', async ({ page }) => {
    await signIn(page)
    await page.goto('/settings/members')
    await expect(page.getByRole('heading', { name: /^members$/i }).first()).toBeVisible({
      timeout: 15_000,
    })
    await assertNoAxeViolations(page, 'settings members (/settings/members)')
  })

  test('promoted P1 home (/home?propertyId=) is axe-clean', async ({ page }) => {
    await signIn(page)
    await page.goto(`/home?propertyId=${seed.p1PropertyId}`)
    await expect(page).toHaveURL(/\/home/)
    // Wait for real page content (the h1), not just the shell.
    await expect(page.getByRole('heading', { name: /^home$/i }).first()).toBeVisible({
      timeout: 15_000,
    })
    await assertNoAxeViolations(page, 'staff home (/home)')
  })
})

test.describe('Critical a11y: keyboard', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('inbox list: j/k moves selection, Enter opens, Escape closes', async ({
    page,
  }) => {
    const { reviewId: reviewA } = await seedReview({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      externalId: `${PREFIX}kb-a-${e2eRunId}`,
      rating: 5,
      text: 'Keyboard review A.',
      reviewerName: 'Kb Alpha',
    })
    await seedReviewInboxItemWithCycle({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      reviewId: reviewA,
      sourceDate: new Date(Date.now() - 60_000),
    })
    const { reviewId: reviewB } = await seedReview({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      externalId: `${PREFIX}kb-b-${e2eRunId}`,
      rating: 1,
      text: 'Keyboard review B.',
      reviewerName: 'Kb Beta',
    })
    await seedReviewInboxItemWithCycle({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      reviewId: reviewB,
      sourceDate: new Date(),
    })

    await signIn(page)
    await page.goto('/inbox')
    const rowA = page.getByRole('button', { name: /open review from kb alpha/i })
    const rowB = page.getByRole('button', { name: /open review from kb beta/i })
    await expect(rowA).toBeVisible({ timeout: 15_000 })
    await expect(rowB).toBeVisible()

    // The contract under test is "j moves down one row, k moves back up" —
    // NOT that these two seeded rows are adjacent. The Inbox is shared, so
    // other specs' items legitimately sort between them, and asserting
    // adjacency made this test about the rest of the suite's fixtures.
    const listOrder = await page
      .getByRole('button', { name: /^open review from /i })
      .evaluateAll((rows) =>
        rows.map((row) =>
          (row.getAttribute('aria-label') ?? '').replace(/^Open review from /i, ''),
        ),
      )
    expect(listOrder.slice(0, 2).length).toBe(2)
    const [firstRow, secondRow] = listOrder

    // 'j' selects the first row and opens the detail.
    await page.keyboard.press('j')
    await expect(page).toHaveURL(/itemId=/, { timeout: 10_000 })
    await expect(page.getByText(firstRow!).nth(1)).toBeVisible({ timeout: 10_000 })
    // 'j' again → the next row down.
    await page.keyboard.press('j')
    await expect(page.getByText(secondRow!).nth(1)).toBeVisible({ timeout: 10_000 })
    // 'k' → back up to the first.
    await page.keyboard.press('k')
    await expect(page.getByText(firstRow!).nth(1)).toBeVisible({ timeout: 10_000 })
    // Escape → detail closes.
    await page.keyboard.press('Escape')
    await expect(page.getByText(/no message selected/i)).toBeVisible({
      timeout: 10_000,
    })
    await expect(page).not.toHaveURL(/itemId=/)

    // Enter on a focused row opens it (row-level keyboard handler).
    await rowA.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/itemId=/, { timeout: 10_000 })
    await expect(page.getByText('Kb Alpha').nth(1)).toBeVisible({ timeout: 10_000 })
  })

  test('tab order reaches primary actions with a visible focus indicator', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/settings/members')
    await expect(page.getByRole('heading', { name: /^members$/i }).first()).toBeVisible({
      timeout: 15_000,
    })

    // Tab-walk: record each focused element; assert every stop is visible and
    // the primary action is reached within a sane number of stops.
    const stops: Array<{ tag: string; text: string; visible: boolean }> = []
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab')
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        const rect = el.getBoundingClientRect()
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? '').trim().slice(0, 40),
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            getComputedStyle(el).visibility !== 'hidden',
        }
      })
      if (stop) stops.push(stop)
      if (stops.some((s) => /invite member/i.test(s.text))) break
    }

    expect(stops.length).toBeGreaterThan(0)
    for (const stop of stops) {
      expect(
        stop.visible,
        `focused element must be visible: ${JSON.stringify(stop)}`,
      ).toBe(true)
    }
    // The primary action (Invite member) is reachable by keyboard in ≤ 25 stops.
    expect(
      stops.some((s) => /invite member/i.test(s.text)),
      `tab order never reached "Invite member": ${JSON.stringify(stops.map((s) => s.text))}`,
    ).toBe(true)

    // Visible focus indicator: the currently focused element (Invite member
    // button — focused via Tab, so :focus-visible applies) shows a ring or
    // outline distinct from its unfocused state.
    const indicator = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const cs = getComputedStyle(el)
      return {
        boxShadow: cs.boxShadow,
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
      }
    })
    const hasIndicator =
      indicator.boxShadow !== 'none' ||
      (indicator.outlineStyle !== 'none' && parseFloat(indicator.outlineWidth) > 0)
    expect(
      hasIndicator,
      `no visible focus indicator on ${JSON.stringify(indicator)}`,
    ).toBe(true)
  })

  test('invite-member dialog traps focus, Escape closes, focus returns to trigger', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/settings/members')
    // Hydration-safe: the trigger is SSR-visible before React attaches the
    // dialog state — clicking in that window no-ops (BQC-6.7 helper).
    await waitForHydration(page)
    const trigger = page.getByRole('button', { name: /invite member/i })
    await expect(trigger).toBeVisible({ timeout: 15_000 })
    await trigger.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Focus moved into the dialog on open (Radix focuses the first field).
    await expect(async () => {
      const inside = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]')
        return dlg?.contains(document.activeElement) ?? false
      })
      expect(inside).toBe(true)
    }).toPass()

    // Tab repeatedly: focus never escapes the dialog (focus trap).
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]')
        return dlg?.contains(document.activeElement) ?? false
      })
      expect(inside, `focus escaped the dialog on Tab #${i + 1}`).toBe(true)
    }
    // Shift+Tab backwards: still trapped.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Shift+Tab')
      const inside = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]')
        return dlg?.contains(document.activeElement) ?? false
      })
      expect(inside, `focus escaped the dialog on Shift+Tab #${i + 1}`).toBe(true)
    }

    // Escape closes the dialog and focus returns to the trigger.
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()
  })
})

test.describe('Critical a11y: reduced motion', () => {
  test('prefers-reduced-motion zeroes computed transition/animation durations', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/settings/members')
    const button = page.getByRole('button', { name: /invite member/i })
    await expect(button).toBeVisible({ timeout: 15_000 })

    // Baseline (no-preference): the button's transition-all gives a real duration.
    const baseline = await button.evaluate((el) =>
      parseFloat(getComputedStyle(el).transitionDuration),
    )
    expect(baseline).toBeGreaterThan(0)

    // Reduce: the global rule (styles.css) zeroes durations with !important.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const reduced = await button.evaluate((el) =>
      parseFloat(getComputedStyle(el).transitionDuration),
    )
    expect(reduced).toBeLessThan(0.001)

    // Animation channel: a probe element with the app's animate-spin utility
    // (used by loading spinners) gets its animation-duration zeroed too.
    const probe = await page.evaluate(() => {
      const el = document.createElement('div')
      el.className = 'animate-spin'
      document.body.appendChild(el)
      const value = parseFloat(getComputedStyle(el).animationDuration)
      el.remove()
      return value
    })
    expect(probe).toBeLessThan(0.001)

    // Restore for the error-detection teardown's sanity.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  })
})

test.describe('Critical a11y: zoom reflow', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  /**
   * style.zoom scrollbar assertion at 200%/400% (the slice-plan mechanism).
   * Content-visibility under emulated zoom is NOT asserted here — style.zoom
   * forces the desktop layout into a crush zone; real browser zoom reflows
   * via media queries (asserted separately at the 320px viewport).
   */
  async function assertZoomReflow(page: import('@playwright/test').Page) {
    for (const zoom of ['200%', '400%']) {
      await page.evaluate((z) => {
        document.body.style.zoom = z
      }, zoom)
      const report = await page.evaluate(() => {
        const viewport = document.documentElement.clientWidth
        const overflow = document.documentElement.scrollWidth - viewport
        // Diagnostics: the widest elements, so a reflow failure names its cause.
        const widest = [...document.querySelectorAll('body *')]
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute('class') ?? '').slice(0, 80),
            width: Math.round(el.getBoundingClientRect().width),
          }))
          .filter((e) => e.width > viewport)
          .sort((a, b) => b.width - a.width)
          .slice(0, 5)
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: viewport,
          overflow,
          widest,
        }
      })
      expect(
        report.scrollWidth,
        `horizontal overflow at ${zoom}: scrollWidth ${report.scrollWidth} > clientWidth ${report.clientWidth}; widest: ${JSON.stringify(report.widest)}`,
      ).toBeLessThanOrEqual(report.clientWidth + 8)
    }
    await page.evaluate(() => {
      document.body.style.zoom = ''
    })
  }

  test('inbox at 200%/400% zoom: no horizontal scrollbar, list stays visible', async ({
    page,
  }) => {
    const { reviewId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      externalId: `${PREFIX}zoom-${e2eRunId}`,
      rating: 3,
      text: 'Zoom reflow review.',
      reviewerName: 'Zoom Reviewer',
    })
    await seedReviewInboxItemWithCycle({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      reviewId,
    })
    await signIn(page)
    await page.goto('/inbox')
    const heading = page.getByRole('heading', { name: /^open reviews$/i }).first()
    await expect(heading).toBeVisible({ timeout: 15_000 })
    const row = page.getByRole('button', { name: /open review from zoom reviewer/i })
    await expect(row).toBeVisible()

    // style.zoom scrollWidth assertions (the mechanism from the slice plan).
    // Content VISIBILITY is then asserted at the 320px viewport below instead
    // of under style.zoom: style.zoom forces the desktop three-panel layout
    // into a crush zone (media queries don't respond to it) where the
    // truncate-class h1 collapses to zero width — real browser zoom switches
    // the inbox to its mobile layout, which the 320px viewport emulates
    // faithfully (see the fleet reflow test for the full rationale).
    await assertZoomReflow(page)

    await page.setViewportSize({ width: 320, height: 900 })
    await expect(heading).toBeVisible()
    await expect(row).toBeVisible()
    const reflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(reflow.scrollWidth).toBeLessThanOrEqual(reflow.clientWidth + 8)
  })

  test('fleet dashboard reflows at the 400%-zoom-equivalent 320px viewport', async ({
    page,
  }) => {
    await seedProperty({
      organizationId: seed.organizationId,
      name: 'A11y Fleet Annex',
      slug: `${PREFIX}fleet-annex-${e2eRunId}`,
      grantAccessToUserId: seed.managerUserId,
    })
    // WCAG 1.4.10 reflow is evaluated at 320 CSS px (≡ 400% zoom on a 1280px
    // desktop). We deliberately use viewport reduction here, not
    // document.body.style.zoom: with style.zoom the docked sidebar's
    // position:fixed container reports a spurious scrollWidth (1536 > 1280
    // with NO element wider than the viewport — a Chromium fixed-pos-in-
    // zoomed-ancestor artifact, verified via the widest-element diagnostic),
    // while real browser zoom re-evaluates media queries exactly like a
    // 320px viewport. The style.zoom mechanism is exercised on /inbox above.
    await page.setViewportSize({ width: 320, height: 900 })
    await signIn(page)
    await page.goto('/dashboard')
    const heading = page.getByText('Needs attention')
    await expect(heading).toBeVisible({ timeout: 15_000 })

    const report = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth
      const widest = [...document.querySelectorAll('body *')]
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute('class') ?? '').slice(0, 80),
          width: Math.round(el.getBoundingClientRect().width),
        }))
        .filter((e) => e.width > viewport)
        .sort((a, b) => b.width - a.width)
        .slice(0, 5)
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: viewport,
        widest,
      }
    })
    expect(
      report.scrollWidth,
      `horizontal overflow at 320px: scrollWidth ${report.scrollWidth} > clientWidth ${report.clientWidth}; widest: ${JSON.stringify(report.widest)}`,
    ).toBeLessThanOrEqual(report.clientWidth + 8)
    // Primary content (a fleet row) remains visible.
    await expect(page.getByText('A11y Fleet Annex').first()).toBeVisible()
  })
})

test.describe('Critical a11y: mobile viewport (390×844)', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('inbox on mobile: rows full-width, no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const { reviewId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      externalId: `${PREFIX}mobile-${e2eRunId}`,
      rating: 4,
      text: 'Mobile viewport review.',
      reviewerName: 'Mobile Reviewer',
    })
    await seedReviewInboxItemWithCycle({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      reviewId,
    })
    await signIn(page)
    await page.goto('/inbox')
    const row = page.getByRole('button', { name: /open review from mobile reviewer/i })
    await expect(row).toBeVisible({ timeout: 15_000 })

    // Rows stay full-width tappable (≈ viewport width minus list padding).
    const rowBox = await row.boundingBox()
    expect(rowBox).not.toBeNull()
    expect(rowBox!.width).toBeGreaterThan(300)

    // No horizontal overflow at mobile width.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 8)
  })

  test('app nav on mobile: collapses to the trigger + drawer pattern', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    // A property-scoped page: the app sidebar renders with the property
    // resolved, so its nav entries are enabled links (on the un-scoped
    // /properties index they render as disabled buttons). /inbox swaps the
    // app sidebar for the inbox folder panel, so the shell nav pattern is
    // asserted here instead.
    await page.goto(`/properties/${seed.propertyId}`)
    await expect(page.getByText(seed.propertyName).first()).toBeVisible({
      timeout: 15_000,
    })

    // The sidebar is not docked at 390px (hidden md:block); navigation goes
    // through the top-bar trigger + mobile drawer (Sheet).
    await waitForHydration(page)
    const sidebarTrigger = page.locator('[data-slot="sidebar-trigger"]').first()
    await expect(sidebarTrigger).toBeVisible()
    await sidebarTrigger.click()
    // The drawer opens the nav (mobile Sheet pattern) — the manager nav's
    // inbox entry is labelled "Reviews".
    await expect(page.getByRole('link', { name: /reviews/i }).first()).toBeVisible({
      timeout: 10_000,
    })
    await page.keyboard.press('Escape')
  })
})
