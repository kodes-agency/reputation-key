import type { CSSProperties } from 'react'

/** Width of the fade that hints at items beyond an edge of the strip. */
export const STRIP_FADE_PX = 24

/** The strip's own `border-b`, which the fade must not thin out. */
const STRIP_DIVIDER_PX = 1

/** Sub-pixel scroll positions still count as sitting on an edge. */
const EDGE_TOLERANCE_PX = 1

export type StripEdges = Readonly<{ atStart: boolean; atEnd: boolean }>

/**
 * The scrollLeft that puts a pill on the strip's start edge, `padding` px in,
 * or null when it is already fully in view with `padding` px to spare on both
 * sides.
 *
 * Start edge, even for a pill clipped on the RIGHT: the strip snaps its pills
 * to their start (`snap-x`, `snap-start`), so a position that is not a pill's
 * start is pulled to the nearest one, and at 320 px that left the active pill
 * half off the edge (253 to 339 in a 320 px strip). The pill's own start is
 * where the browser would put it anyway, and it shows the pill whole unless it
 * is wider than the view. `padding` is therefore the strip's scroll padding.
 *
 * `pillLeft` is measured in scroll-content coordinates (not the viewport), so
 * the strip's own scroll offset is not part of it.
 */
export function stripScrollLeftFor({
  pillLeft,
  pillWidth,
  scrollLeft,
  clientWidth,
  padding,
}: Readonly<{
  pillLeft: number
  pillWidth: number
  scrollLeft: number
  clientWidth: number
  padding: number
}>): number | null {
  const wantedLeft = pillLeft - padding
  const wantedRight = pillLeft + pillWidth + padding
  const inView = wantedLeft >= scrollLeft && wantedRight <= scrollLeft + clientWidth
  const next = Math.max(0, wantedLeft)
  return inView || next === scrollLeft ? null : next
}

/** Which edges of the strip the scroll position currently rests on. */
export function stripEdgesFor({
  scrollLeft,
  clientWidth,
  scrollWidth,
}: Readonly<{
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
}>): StripEdges {
  return {
    atStart: scrollLeft <= EDGE_TOLERANCE_PX,
    atEnd: scrollLeft + clientWidth >= scrollWidth - EDGE_TOLERANCE_PX,
  }
}

/**
 * The fade mask for the strip, or undefined when every pill fits.
 *
 * Two layers: the horizontal fade over everything above the divider, plus an
 * opaque 1px band for the divider itself, so the border-b keeps running to
 * the screen edge instead of tapering with the pills.
 */
export function stripFadeStyle({
  atStart,
  atEnd,
}: StripEdges): CSSProperties | undefined {
  if (atStart && atEnd) return undefined
  const fade = `${STRIP_FADE_PX}px`
  const stops = [
    ...(atStart ? [] : ['transparent', `#000 ${fade}`]),
    ...(atEnd ? [] : [`#000 calc(100% - ${fade})`, 'transparent']),
  ]
  const image = `linear-gradient(to right, ${stops.join(', ')}), linear-gradient(#000, #000)`
  const size = `100% calc(100% - ${STRIP_DIVIDER_PX}px), 100% ${STRIP_DIVIDER_PX}px`
  const position = '0 0, 0 100%'
  return {
    maskImage: image,
    maskSize: size,
    maskPosition: position,
    maskRepeat: 'no-repeat',
    WebkitMaskImage: image,
    WebkitMaskSize: size,
    WebkitMaskPosition: position,
    WebkitMaskRepeat: 'no-repeat',
  }
}

/**
 * Scroll the strip so its current item (the `aria-current="page"` one) sits on
 * the start edge. Sets scrollLeft on the strip itself: scrollIntoView could also
 * scroll the page around it.
 *
 * The breathing room is the strip's scroll padding, never less than the edge
 * fade's width, so the revealed item clears the 24px fade instead of sitting
 * half under it. A strip that snaps keeps `scroll-px-6`, the same width, so this
 * position is one the snap keeps rather than pulls to the nearest item. Measured
 * from bounding boxes, so it holds whichever ancestor is the item's offset parent.
 */
export function revealCurrentItem(strip: HTMLElement) {
  const item = strip.querySelector<HTMLElement>('[aria-current="page"]')
  if (!item) return
  const stripRect = strip.getBoundingClientRect()
  const itemRect = item.getBoundingClientRect()
  const next = stripScrollLeftFor({
    pillLeft: itemRect.left - stripRect.left - strip.clientLeft + strip.scrollLeft,
    pillWidth: itemRect.width,
    scrollLeft: strip.scrollLeft,
    clientWidth: strip.clientWidth,
    padding: Math.max(
      Number.parseFloat(getComputedStyle(strip).scrollPaddingLeft) || 0,
      STRIP_FADE_PX,
    ),
  })
  if (next !== null) strip.scrollLeft = next
}
