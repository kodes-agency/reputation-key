// Where a part of the previewed page sits, in the page's own pixels. The page is
// laid out at a real phone's width and scaled with a transform, so a part's
// place on screen is divided by the scale; the boxes then position the buttons
// that make the parts selectable, inside the same scaled frame.

import {
  PREVIEW_PART_SECTIONS,
  PREVIEW_PART_SELECTORS,
  type PreviewPartSection,
} from './preview-parts'

export type Box = Readonly<{ top: number; left: number; width: number; height: number }>

export type PartBox = Readonly<{ section: PreviewPartSection; box: Box }>

/** The smallest box holding all of `boxes`; none for none. */
export function unionBox(boxes: readonly Box[]): Box | null {
  const first = boxes[0]
  if (first === undefined) return null
  let top = first.top
  let left = first.left
  let bottom = first.top + first.height
  let right = first.left + first.width
  for (const next of boxes) {
    top = Math.min(top, next.top)
    left = Math.min(left, next.left)
    bottom = Math.max(bottom, next.top + next.height)
    right = Math.max(right, next.left + next.width)
  }
  return { top, left, width: right - left, height: bottom - top }
}

/** The scale a frame is drawn at: its width on screen over its width in layout. */
export function pageScale(drawnWidth: number, layoutWidth: number): number {
  return layoutWidth > 0 && drawnWidth > 0 ? drawnWidth / layoutWidth : 1
}

/** A box seen on screen, as the page's own pixels measured from `frame`'s corner. */
export function toPageBox(onScreen: Box, frame: Box, scale: number): Box {
  return {
    top: (onScreen.top - frame.top) / scale,
    left: (onScreen.left - frame.left) / scale,
    width: onScreen.width / scale,
    height: onScreen.height / scale,
  }
}

/** A box grown by `by` on every side, kept inside the page, whose frame clips anything beyond it. */
export function padBox(box: Box, by: number, pageWidth: number): Box {
  const top = Math.max(0, box.top - by)
  const left = Math.max(0, box.left - by)
  const right = Math.min(pageWidth, box.left + box.width + by)
  const bottom = box.top + box.height + by
  return { top, left, width: right - left, height: bottom - top }
}

export function sameBoxes(a: readonly PartBox[], b: readonly PartBox[]): boolean {
  return (
    a.length === b.length &&
    a.every((one, index) => {
      const other = b[index]
      return (
        other !== undefined &&
        one.section === other.section &&
        one.box.top === other.box.top &&
        one.box.left === other.box.left &&
        one.box.width === other.box.width &&
        one.box.height === other.box.height
      )
    })
  )
}

/** Room around a part for its outline. */
const OUTLINE_GAP = 4

const toBox = (rect: DOMRect): Box => ({
  top: rect.top,
  left: rect.left,
  width: rect.width,
  height: rect.height,
})

/**
 * Every part the drawn page has, top to bottom, which is the order Tab visits
 * them in. `content` is what draws the page; `frame` is the box the buttons are
 * positioned in.
 */
export function measurePartBoxes(
  content: ParentNode,
  frame: HTMLElement,
): readonly PartBox[] {
  const frameBox = toBox(frame.getBoundingClientRect())
  const scale = pageScale(frameBox.width, frame.offsetWidth)
  const found: PartBox[] = []
  for (const section of PREVIEW_PART_SECTIONS) {
    for (const selector of PREVIEW_PART_SELECTORS[section]) {
      const elements = Array.from(content.querySelectorAll(selector))
      if (elements.length === 0) continue
      const onScreen = unionBox(
        elements.map((element) => toBox(element.getBoundingClientRect())),
      )
      if (onScreen !== null && onScreen.height > 0) {
        found.push({
          section,
          box: padBox(
            toPageBox(onScreen, frameBox, scale),
            OUTLINE_GAP,
            frame.offsetWidth,
          ),
        })
      }
      break
    }
  }
  return [...found].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
}
