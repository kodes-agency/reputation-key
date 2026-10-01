// The focal point of the Property's photograph: where, from 0 to 1 across and
// down, every page crops around when it shows the photo in a box of another
// shape. Pure rules for the picker (where a pointer or an arrow key puts it, how
// it is read out), so the component only has to wire events.

export type FocalPoint = Readonly<{ x: number; y: number }>

/** The middle of the photograph, where a new photo starts. */
export const CENTRE_FOCAL: FocalPoint = { x: 0.5, y: 0.5 }

/** How far one arrow key press moves the point, and one with Shift held. */
export const FOCAL_STEP = 0.02
export const FOCAL_LARGE_STEP = 0.1

/** Three decimals is a tenth of a percent: finer than anyone can place a point, and a value the database reads back unchanged. */
const PRECISION = 1000

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value))
const rounded = (value: number): number =>
  Math.round(clampUnit(value) * PRECISION) / PRECISION

export const sameFocal = (first: FocalPoint, second: FocalPoint): boolean =>
  first.x === second.x && first.y === second.y

type PointerPoint = Readonly<{ clientX: number; clientY: number }>
type Box = Readonly<{ left: number; top: number; width: number; height: number }>

/** The focal point under a pointer over the photo's box; the edge for a pointer past it. A box with no size has no answer. */
export function focalFromPointer(pointer: PointerPoint, box: Box): FocalPoint | null {
  if (box.width <= 0 || box.height <= 0) return null
  return {
    x: rounded((pointer.clientX - box.left) / box.width),
    y: rounded((pointer.clientY - box.top) / box.height),
  }
}

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** The point after an arrow key, or null for any other key. Shift moves further; the point stops at the edge of the photo. */
export function nudgeFocal(
  focal: FocalPoint,
  key: string,
  isLarge: boolean,
): FocalPoint | null {
  const direction = ARROWS[key]
  if (!direction) return null
  const step = isLarge ? FOCAL_LARGE_STEP : FOCAL_STEP
  return {
    x: rounded(focal.x + direction[0] * step),
    y: rounded(focal.y + direction[1] * step),
  }
}

const percent = (value: number): number => Math.round(clampUnit(value) * 100)

/** "50% across, 42% down", for the picker's name and for anyone who cannot see it. */
export const describeFocal = (focal: FocalPoint): string =>
  `${percent(focal.x)}% across, ${percent(focal.y)}% down`

/** The width that keeps a photograph of this shape within the height and width given. */
export function pickerWidth(
  ratio: number,
  maxHeightRem: number,
  maxWidthRem = Number.POSITIVE_INFINITY,
): string {
  const rem = Math.min(ratio * maxHeightRem, maxWidthRem)
  return `min(100%, ${Math.round(rem * 100) / 100}rem)`
}
