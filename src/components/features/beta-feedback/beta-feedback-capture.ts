// Capture the page as geometry, in the browser, reading nothing.
//
// The walk touches exactly three things per element: its tag name (to pick a
// role from a closed vocabulary), its bounding rectangle, and whether it is
// visible. It never reads `textContent`, `value`, `src`, `href`, `alt`, `id`,
// `class`, a dataset entry or any other attribute value, so no page content can
// reach the returned object — there is no field for it to sit in.

import {
  MASKED_LAYOUT_MAX_BOXES,
  type MaskedLayout,
  type MaskedLayoutBox,
  type MaskedLayoutRole,
} from '#/shared/beta-feedback-layout'

/** Anything inside the feedback dialog is the reporter's own draft, not the bug. */
const EXCLUDE_SELECTOR = '[data-beta-feedback-capture-exclude]'

/** Below this a box is noise; it also keeps the budget for meaningful blocks. */
const MIN_SIDE_PX = 8

/**
 * A box covering nearly the whole viewport is a page shell (html, body, the app
 * root, a full-height layout wrapper). It says nothing about the layout and,
 * stacked, it washes the picture out — so it is left out, and its share of the
 * budget goes to blocks that mean something.
 */
const SHELL_COVERAGE = 0.95

const TAG_ROLE: Readonly<Record<string, MaskedLayoutRole>> = {
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  P: 'text',
  SPAN: 'text',
  LI: 'text',
  TD: 'text',
  TH: 'text',
  LABEL: 'text',
  STRONG: 'text',
  EM: 'text',
  CODE: 'text',
  IMG: 'image',
  SVG: 'image',
  PICTURE: 'image',
  CANVAS: 'media',
  VIDEO: 'media',
  AUDIO: 'media',
  IFRAME: 'media',
  INPUT: 'input',
  TEXTAREA: 'input',
  SELECT: 'input',
  BUTTON: 'button',
  A: 'link',
}

/** Coarse grid: enough to see the layout, too coarse to fingerprint a viewport. */
function snap(value: number): number {
  return Math.round(value / 4) * 4
}

function roleFor(element: Element): MaskedLayoutRole {
  return TAG_ROLE[element.tagName.toUpperCase()] ?? 'container'
}

function isRendered(element: Element, rect: DOMRect): boolean {
  if (rect.width < MIN_SIDE_PX || rect.height < MIN_SIDE_PX) return false
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  if (!style) return true
  return style.visibility !== 'hidden' && style.display !== 'none'
}

type CaptureRoot = Readonly<{
  document: Document
  viewportWidth: number
  viewportHeight: number
}>

/**
 * Walk the visible page and return its geometry, or null when there is nothing
 * worth showing. Elements are taken in document order and the budget is a hard
 * stop, so a large page yields the top of the document rather than failing.
 */
export function captureMaskedLayout(root: CaptureRoot): MaskedLayout | null {
  const width = snap(root.viewportWidth)
  const height = snap(root.viewportHeight)
  if (width < 1 || height < 1) return null

  const boxes: MaskedLayoutBox[] = []
  const elements = root.document.body?.querySelectorAll('*') ?? []

  for (const element of elements) {
    if (boxes.length >= MASKED_LAYOUT_MAX_BOXES) break
    if (element.closest(EXCLUDE_SELECTOR)) continue

    const rect = element.getBoundingClientRect()
    if (!isRendered(element, rect)) continue
    if (
      rect.width >= root.viewportWidth * SHELL_COVERAGE &&
      rect.height >= root.viewportHeight * SHELL_COVERAGE
    ) {
      continue
    }
    // Off-screen blocks say nothing about what the reporter was looking at.
    if (rect.bottom < 0 || rect.top > root.viewportHeight) continue

    boxes.push({
      x: snap(rect.left),
      y: snap(rect.top),
      w: snap(rect.width),
      h: snap(rect.height),
      role: roleFor(element),
    })
  }

  if (boxes.length === 0) return null
  return { width, height, boxes }
}

/** Capture from the live page; returns null anywhere there is no DOM. */
export function captureCurrentMaskedLayout(): MaskedLayout | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  try {
    return captureMaskedLayout({
      document,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    })
  } catch {
    // A capture failure must never block the report it was meant to enrich.
    return null
  }
}
