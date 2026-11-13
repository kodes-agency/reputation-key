// Layout checks a journey applies to a UI state it has opened: the page does not
// scroll sideways, and every control is at least a finger wide and tall.

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
      const text =
        element.getAttribute('aria-label') ?? (element.textContent ?? '').trim()
      return `${element.tagName.toLowerCase()} "${text.slice(0, 40)}"`
    }
    const isInline = (element: Element): boolean =>
      element.tagName === 'A' &&
      getComputedStyle(element).display === 'inline' &&
      element.closest('p, li, dd, span') !== null
    return Array.from(document.querySelectorAll(selector))
      .filter((element) => {
        const style = getComputedStyle(element)
        const box = element.getBoundingClientRect()
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          box.width > 0 &&
          box.height > 0 &&
          // A link inside a sentence takes its size from the text around it.
          !isInline(element) &&
          // The skip link and other off-screen helpers are not tapped.
          box.right > 0 &&
          box.bottom > 0
        )
      })
      .map((element) => {
        const box = element.getBoundingClientRect()
        return { label: labelOf(element), width: box.width, height: box.height }
      })
  }, CONTROL_SELECTOR)
}

/** Every control on the page is at least 44 px wide and tall. */
export async function expectTouchTargets(page: Page): Promise<void> {
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
