// Layout checks a journey applies to a UI state it has opened: on a phone, the
// page does not scroll sideways, and every control is at least a finger wide and
// tall.

import { expect, type Page } from '@playwright/test'

export const MIN_TOUCH_TARGET_PX = 44
export const PHONE_VIEWPORT = { width: 390, height: 844 } as const

export type TouchTarget = Readonly<{
  label: string
  width: number
  height: number
}>

/** The controls smaller than `min` in either direction, named for the failure message. */
export function smallTouchTargets(
  targets: ReadonlyArray<TouchTarget>,
  min: number = MIN_TOUCH_TARGET_PX,
): ReadonlyArray<string> {
  return targets
    .filter((target) => target.width < min - 0.5 || target.height < min - 0.5)
    .map(
      (target) =>
        `${target.label} (${Math.round(target.width)}×${Math.round(target.height)})`,
    )
}

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
 * Waits until every finite animation and transition on the page has finished, so
 * a sheet that is still sliding in is not measured. A looping animation (a
 * spinner) never ends and is not waited for.
 */
export async function waitForAnimationsToSettle(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState !== 'finished' &&
                animation.effect?.getComputedTiming().iterations !== Infinity,
            ).length,
      ),
    )
    .toBe(0)
}

const CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="combobox"]',
].join(',')

async function visibleControls(page: Page): Promise<ReadonlyArray<TouchTarget>> {
  return page.evaluate((selector) => {
    const labelOf = (element: Element): string => {
      const label =
        element instanceof HTMLInputElement ? element.labels?.[0]?.textContent : ''
      const text =
        element.getAttribute('aria-label') ||
        label?.trim() ||
        (element.textContent ?? '').trim()
      return `${element.tagName.toLowerCase()} "${text.slice(0, 40)}"`
    }
    const isInline = (element: Element): boolean =>
      element.tagName === 'A' &&
      getComputedStyle(element).display === 'inline' &&
      element.closest('p, li, dd, span') !== null
    // What the user cannot see or reach is not tapped: a hidden field, an inert
    // layer behind a dialog, an off-screen skip link.
    const isShown = (element: Element): boolean =>
      element.closest('[hidden], [inert], [aria-hidden="true"]') === null &&
      element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
      element.getClientRects().length > 0
    // What a finger can press for a control: its box, its label's (a checkbox or
    // radio is tapped through it, drawn or visually hidden), or a pad drawn
    // around it by an absolutely positioned pseudo-element.
    const pressable = (control: Element): { width: number; height: number }[] => {
      const labels =
        control instanceof HTMLInputElement ? Array.from(control.labels ?? []) : []
      return [control, ...labels].filter(isShown).flatMap((target) => {
        const { width, height } = target.getBoundingClientRect()
        const pads = ['::before', '::after'].flatMap((pseudo) => {
          const style = getComputedStyle(target, pseudo)
          const isDrawn = style.content !== 'none' && style.content !== 'normal'
          return isDrawn &&
            style.position === 'absolute' &&
            style.pointerEvents !== 'none'
            ? [
                {
                  width: Number.parseFloat(style.width),
                  height: Number.parseFloat(style.height),
                },
              ]
            : []
        })
        return [{ width, height }, ...pads]
      })
    }
    return Array.from(document.querySelectorAll(selector)).flatMap((control) => {
      const boxes = pressable(control)
      const { right, bottom } = control.getBoundingClientRect()
      // The skip link and other off-screen helpers are not tapped.
      if (boxes.length === 0 || right <= 0 || bottom <= 0 || isInline(control)) return []
      const best = boxes.reduce((a, b) =>
        Math.min(b.width, b.height) > Math.min(a.width, a.height) ? b : a,
      )
      return [{ label: labelOf(control), ...best }]
    })
  }, CONTROL_SELECTOR)
}

/** Every control on the page is at least 44 px wide and tall. */
export async function expectTouchTargets(page: Page): Promise<void> {
  await waitForAnimationsToSettle(page)
  const small = smallTouchTargets(await visibleControls(page))
  expect(small, `controls under ${MIN_TOUCH_TARGET_PX} px`).toEqual([])
}

/**
 * A state, seen on a phone: no sideways scroll and no control under 44 px. The
 * window goes back to its size afterwards.
 */
export async function expectPhoneLayout(page: Page): Promise<void> {
  const before = page.viewportSize()
  await page.setViewportSize(PHONE_VIEWPORT)
  try {
    await expectNoHorizontalOverflow(page)
    await expectTouchTargets(page)
  } finally {
    if (before) await page.setViewportSize(before)
  }
}
