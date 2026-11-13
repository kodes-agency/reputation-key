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

/**
 * Controls an open phone-width batch (#1936) is resizing, by name. A journey names
 * the fix a state still waits on when it calls the check; a state that names
 * nothing keeps every control checked. Remove an entry, and its call sites, when
 * that PR lands.
 */
export const PENDING_PHONE_WIDTH_FIXES = {
  appTopBar: {
    selector: 'header[data-density="compact"] :is(button, a[href])',
    reason: 'the app top bar controls are 36 px until #1936',
  },
  propertyListSetupLinks: {
    selector: 'a[aria-label^="Setup "]',
    reason: 'the Property list setup links are 38 px tall until #1936',
  },
} as const satisfies Record<string, Readonly<{ selector: string; reason: string }>>

export type PendingPhoneWidthFix = keyof typeof PENDING_PHONE_WIDTH_FIXES

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

async function visibleControls(
  page: Page,
  pending: ReadonlyArray<PendingPhoneWidthFix>,
): Promise<ReadonlyArray<TouchTarget>> {
  return page.evaluate(
    ({ selector, pending }) => {
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
          if (pending.some((pendingSelector) => element.matches(pendingSelector)))
            return false
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
    },
    {
      selector: CONTROL_SELECTOR,
      pending: pending.map((name) => PENDING_PHONE_WIDTH_FIXES[name].selector),
    },
  )
}

/** Every control on the page is at least 44 px wide and tall. */
export async function expectTouchTargets(
  page: Page,
  pending: ReadonlyArray<PendingPhoneWidthFix> = [],
): Promise<void> {
  const small = smallTouchTargets(await visibleControls(page, pending))
  expect(small, `controls under ${MIN_TOUCH_TARGET_PX} px`).toEqual([])
}

/**
 * A state, seen on a phone: no sideways scroll and no control under 44 px. The
 * window goes back to its size afterwards.
 */
export async function expectPhoneLayout(
  page: Page,
  pending: ReadonlyArray<PendingPhoneWidthFix> = [],
): Promise<void> {
  const before = page.viewportSize()
  await page.setViewportSize(PHONE_VIEWPORT)
  try {
    await expectNoHorizontalOverflow(page)
    await expectTouchTargets(page, pending)
  } finally {
    if (before) await page.setViewportSize(before)
  }
}
