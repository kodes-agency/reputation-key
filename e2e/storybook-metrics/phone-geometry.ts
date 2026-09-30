// Where things sit on a PHONE, as the inbox's phone grid states it, measured in
// a real browser against compiled Tailwind. The pane gate (`pane-metrics.ts`)
// asks "is every target big enough and does nothing overflow"; this asks "is it
// on the grid": a 16 px gutter, 44 px bars, 36 px controls, 32 px pills.
//
// ── What "on the gutter" means ──────────────────────────────────────────────
//
// A ghost icon button draws no box at rest, so its GLYPH is what a reader sees
// and what has to sit on the gutter (the button is pulled out by half of its
// size minus the glyph: `-ml-2.5` for a 36 px button and a 16 px glyph). An
// outlined or filled box puts its BOX edge there instead. Both reduce to one
// number per element, its INK: the union of the text it draws and the icons in
// it. A 36 px ghost button at x=6 has an ink that starts at x=16; an outline
// button at x=16 has a box at 16 and an ink at 26. Which of the two a check
// reads is the check's decision (`ink` or `box`), stated where it is made.
//
// Ink is measured, not derived from the box, because the whole point is to catch
// the class of defect a box test cannot: a `-ml-2` where `-ml-2.5` was meant
// leaves every box the right size and the arrow 2 px off the line.

import type { Page } from '@playwright/test'

/** The phone gutter, and how far a position may drift from it. */
export const GUTTER_PX = 16
export const POSITION_TOLERANCE_PX = 1
/** Sizes are whole pixels in Tailwind; half a pixel absorbs layout rounding only. */
const SIZE_TOLERANCE_PX = 0.5

export type Box = Readonly<{
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}>

/** The horizontal and vertical extent of what an element draws; null if it draws nothing. */
export type Ink = Readonly<{ left: number; right: number; top: number; bottom: number }>

export type MeasuredControl = Readonly<{
  name: string
  role: string
  box: Box
  ink: Ink | null
  /** The size of the tap target: the box, or a `::after` pad that is larger. */
  hit: Readonly<{ width: number; height: number }>
}>

export type ScopeReport = Readonly<{
  selector: string
  found: boolean
  box: Box
  ink: Ink | null
  /**
   * The box of the first descendant that does not span the scope: where a
   * full-width region's content actually starts. Null if everything spans.
   */
  content: Box | null
  controls: ReadonlyArray<MeasuredControl>
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
  scrollHeight: number
  clientHeight: number
  borderLeftWidth: number
  borderRightWidth: number
}>

export type PageReport = Readonly<{
  innerWidth: number
  innerHeight: number
  documentScrollWidth: number
}>

/**
 * Runs in the page, so it reads nothing outside its own body. Reports on every
 * VISIBLE element `selector` matches, in document order.
 */
function measureScopes(selector: string): ReadonlyArray<ScopeReport> {
  const interactive =
    'button, a[href], input, textarea, select, [role="button"], [role="combobox"], ' +
    '[role="radio"], [role="checkbox"], [role="tab"], [role="menuitem"]'
  const round = (n: number): number => Math.round(n * 10) / 10
  const boxOf = (rect: DOMRect): Box => ({
    left: round(rect.left),
    right: round(rect.right),
    top: round(rect.top),
    bottom: round(rect.bottom),
    width: round(rect.width),
    height: round(rect.height),
  })
  const isShown = (el: Element): boolean =>
    el.checkVisibility() && el.closest('.sr-only') === null
  // A rect the element draws, narrowed to the boxes that clip it: a truncated
  // name's text node is wider than the span that cuts it off, and only the
  // part inside the span is on screen.
  const clipped = (rect: DOMRect, from: Element | null): DOMRect | null => {
    let left = rect.left
    let right = rect.right
    for (let el = from; el !== null; el = el.parentElement) {
      const style = getComputedStyle(el)
      if (style.overflowX === 'visible') continue
      const clip = el.getBoundingClientRect()
      left = Math.max(left, clip.left)
      right = Math.min(right, clip.right)
    }
    return right > left ? new DOMRect(left, rect.top, right - left, rect.height) : null
  }
  const inkOf = (root: Element): Ink | null => {
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    const add = (rect: DOMRect | null): void => {
      if (rect === null || rect.width <= 0 || rect.height <= 0) return
      left = Math.min(left, rect.left)
      right = Math.max(right, rect.right)
      top = Math.min(top, rect.top)
      bottom = Math.max(bottom, rect.bottom)
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement
      if (parent === null || (node.textContent ?? '').trim() === '' || !isShown(parent))
        continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of Array.from(range.getClientRects())) add(clipped(rect, parent))
    }
    const drawn = root.matches('svg, input, textarea')
      ? [root]
      : Array.from(root.querySelectorAll('svg, input, textarea'))
    for (const el of drawn) {
      if (isShown(el)) add(clipped(el.getBoundingClientRect(), el.parentElement))
    }
    return left === Infinity ? null : { left, right, top, bottom }
  }
  const round1 = (ink: Ink | null): Ink | null =>
    ink === null
      ? null
      : {
          left: round(ink.left),
          right: round(ink.right),
          top: round(ink.top),
          bottom: round(ink.bottom),
        }
  const nameOf = (el: Element): string =>
    el.getAttribute('aria-label') ??
    ((el.textContent ?? '').replace(/\s+/g, ' ').trim() ||
      el.getAttribute('placeholder') ||
      el.tagName.toLowerCase())
  const hitOf = (el: Element, box: Box): { width: number; height: number } => {
    const pad = getComputedStyle(el, '::after')
    const width = pad.content === 'none' ? 0 : Number.parseFloat(pad.width) || 0
    const height = pad.content === 'none' ? 0 : Number.parseFloat(pad.height) || 0
    return { width: Math.max(box.width, width), height: Math.max(box.height, height) }
  }

  const contentOf = (scope: Element): Box | null => {
    const spans = scope.getBoundingClientRect().width - 1
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const el = node as Element
      if (!isShown(el)) continue
      const rect = el.getBoundingClientRect()
      if (rect.height > 0 && rect.width > 0 && rect.width < spans) return boxOf(rect)
    }
    return null
  }
  const report = (scope: Element): ScopeReport => {
    const style = getComputedStyle(scope)
    return {
      selector,
      found: true,
      box: boxOf(scope.getBoundingClientRect()),
      ink: round1(inkOf(scope)),
      content: contentOf(scope),
      controls: Array.from(scope.querySelectorAll(interactive))
        .filter(isShown)
        .map((el): MeasuredControl => {
          const box = boxOf(el.getBoundingClientRect())
          return {
            name: nameOf(el),
            role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
            box,
            ink: round1(inkOf(el)),
            hit: hitOf(el, box),
          }
        }),
      scrollLeft: scope.scrollLeft,
      scrollWidth: scope.scrollWidth,
      clientWidth: scope.clientWidth,
      scrollHeight: scope.scrollHeight,
      clientHeight: scope.clientHeight,
      borderLeftWidth: Number.parseFloat(style.borderLeftWidth) || 0,
      borderRightWidth: Number.parseFloat(style.borderRightWidth) || 0,
    }
  }
  return Array.from(document.querySelectorAll(selector))
    .filter((el) => el.checkVisibility())
    .map(report)
}

const NOT_FOUND = (selector: string): ScopeReport => ({
  selector,
  found: false,
  box: { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 },
  ink: null,
  content: null,
  controls: [],
  scrollLeft: 0,
  scrollWidth: 0,
  clientWidth: 0,
  scrollHeight: 0,
  clientHeight: 0,
  borderLeftWidth: 0,
  borderRightWidth: 0,
})

/** Every visible match, in document order. */
export function measureAll(
  page: Page,
  selector: string,
): Promise<ReadonlyArray<ScopeReport>> {
  return page.evaluate(measureScopes, selector)
}

/** The first visible match, or a report that says none was found. */
export async function measure(page: Page, selector: string): Promise<ScopeReport> {
  return (await measureAll(page, selector))[0] ?? NOT_FOUND(selector)
}
export function measurePage(page: Page): Promise<PageReport> {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    documentScrollWidth: document.documentElement.scrollWidth,
  }))
}

// ── Verdicts ────────────────────────────────────────────────────────────────
// Each returns one line per violation, or none. A line names the story and
// width (added by the caller), the element and the measured number.

const near = (actual: number, expected: number, tolerance: number): boolean =>
  Math.abs(actual - expected) <= tolerance

export function found(report: ScopeReport, what: string): ReadonlyArray<string> {
  return report.found ? [] : [`${what}: no visible element matched ${report.selector}`]
}

/** The document must not scroll sideways: nothing on the page is wider than the window. */
export function noSidewaysScroll(page: PageReport): ReadonlyArray<string> {
  return page.documentScrollWidth > page.innerWidth
    ? [
        `the document scrolls sideways: scrollWidth ${page.documentScrollWidth} > window ${page.innerWidth}`,
      ]
    : []
}

/** A bar or row: exactly this tall. */
export function heightIs(
  what: string,
  box: Box,
  expected: number,
): ReadonlyArray<string> {
  return near(box.height, expected, SIZE_TOLERANCE_PX)
    ? []
    : [`${what} is ${box.height} px tall, expected ${expected}`]
}

/** A bar or row that spans the window: it starts at 0 and ends at the window's edge. */
export function spansWindow(
  what: string,
  box: Box,
  page: PageReport,
): ReadonlyArray<string> {
  return near(box.left, 0, SIZE_TOLERANCE_PX) &&
    near(box.width, page.innerWidth, SIZE_TOLERANCE_PX)
    ? []
    : [
        `${what} spans x=${box.left}..${box.right} (${box.width} px) in a ${page.innerWidth} px window`,
      ]
}

/** Ink starting at `x`. */
export function inkStartsAt(
  what: string,
  ink: Ink | null,
  x: number,
): ReadonlyArray<string> {
  if (ink === null) return [`${what} draws nothing, so nothing sits at x=${x}`]
  return near(ink.left, x, POSITION_TOLERANCE_PX)
    ? []
    : [`${what} starts at x=${ink.left}, expected ${x}`]
}

/** Ink starting on the leading gutter. */
export function inkStartsOnGutter(what: string, ink: Ink | null): ReadonlyArray<string> {
  return inkStartsAt(what, ink, GUTTER_PX)
}

/** Ink ending on the trailing gutter. */
export function inkEndsOnGutter(
  what: string,
  ink: Ink | null,
  page: PageReport,
): ReadonlyArray<string> {
  if (ink === null) return [`${what} draws nothing, so nothing sits on the gutter`]
  const expected = page.innerWidth - GUTTER_PX
  return near(ink.right, expected, POSITION_TOLERANCE_PX)
    ? []
    : [`${what} ends at x=${ink.right}, expected ${expected} (window - ${GUTTER_PX})`]
}

/** Ink that stays out of the trailing gutter: an upper bound, for text that may run short. */
export function inkStaysInsideGutter(
  what: string,
  ink: Ink | null,
  page: PageReport,
): ReadonlyArray<string> {
  if (ink === null) return []
  const limit = page.innerWidth - GUTTER_PX + POSITION_TOLERANCE_PX
  return ink.right > limit
    ? [`${what} reaches x=${ink.right}, past the ${limit - POSITION_TOLERANCE_PX} gutter`]
    : []
}

/** A box whose left edge is at `x`. */
export function boxStartsAt(what: string, box: Box, x: number): ReadonlyArray<string> {
  return near(box.left, x, POSITION_TOLERANCE_PX)
    ? []
    : [`${what}'s box starts at x=${box.left}, expected ${x}`]
}

export function boxStartsOnGutter(what: string, box: Box): ReadonlyArray<string> {
  return boxStartsAt(what, box, GUTTER_PX)
}

export function boxEndsOnGutter(
  what: string,
  box: Box,
  page: PageReport,
): ReadonlyArray<string> {
  const expected = page.innerWidth - GUTTER_PX
  return near(box.right, expected, POSITION_TOLERANCE_PX)
    ? []
    : [
        `${what}'s box ends at x=${box.right}, expected ${expected} (window - ${GUTTER_PX})`,
      ]
}

/** Every control exactly this tall. */
export function heightsAre(
  controls: ReadonlyArray<MeasuredControl>,
  height: number,
): ReadonlyArray<string> {
  return controls
    .filter((control) => !near(control.box.height, height, SIZE_TOLERANCE_PX))
    .map(
      (control) =>
        `"${control.name}" (${control.role}) is ${control.box.width}x${control.box.height}, expected ${height} tall`,
    )
}

/**
 * The controls of one bar: every one exactly `height` tall and all on one top
 * edge. A checkbox is a 16 px glyph with a larger tap target, so it is held to
 * the bar's centre line, not to its top.
 */
export function controlsAre(
  controls: ReadonlyArray<MeasuredControl>,
  height: number,
): ReadonlyArray<string> {
  const boxes = controls.filter((control) => control.role !== 'checkbox')
  const checkboxes = controls.filter((control) => control.role === 'checkbox')
  const first = boxes[0]
  if (first === undefined) return []
  const centre = first.box.top + first.box.height / 2
  return [
    ...heightsAre(boxes, height),
    ...boxes
      .filter((control) => !near(control.box.top, first.box.top, SIZE_TOLERANCE_PX))
      .map(
        (control) =>
          `"${control.name}" (${control.role}) tops out at y=${control.box.top}, not at "${first.name}"'s y=${first.box.top}`,
      ),
    ...checkboxes
      .filter(
        (control) =>
          !near(control.box.top + control.box.height / 2, centre, SIZE_TOLERANCE_PX),
      )
      .map(
        (control) =>
          `"${control.name}" (${control.role}) is centred at y=${control.box.top + control.box.height / 2}, not on the bar's y=${centre}`,
      ),
  ]
}

/** No control's tap target is smaller than `min` on its smaller side. */
export function hitsAtLeast(
  controls: ReadonlyArray<MeasuredControl>,
  min: number,
): ReadonlyArray<string> {
  return controls
    .filter((control) => Math.min(control.hit.width, control.hit.height) < min)
    .map(
      (control) =>
        `"${control.name}" (${control.role}) has a ${control.hit.width}x${control.hit.height} tap target, under ${min}`,
    )
}

/** A box that lies wholly inside the window. */
export function insideWindow(
  what: string,
  box: Box,
  page: PageReport,
): ReadonlyArray<string> {
  const slack = SIZE_TOLERANCE_PX
  return box.left < -slack ||
    box.top < -slack ||
    box.right > page.innerWidth + slack ||
    box.bottom > page.innerHeight + slack
    ? [
        `${what} is x=${box.left}..${box.right}, y=${box.top}..${box.bottom}, outside the ${page.innerWidth}x${page.innerHeight} window`,
      ]
    : []
}
