// How an Immersive face shares its height (spec 2.5): the brand fixed at the top
// margin, the code block at the bottom margin, and between them the photo window,
// the words and two flexible gaps. The window grows first, from its floor to its
// cap, as the boards' flex-grow of 1000 against 1 grows it; the gaps only get
// what is left once it reaches its cap. By the same token it is the first thing
// to give way.
//
// When the window cannot reach its floor, the fit order takes space back, one
// step at a time and only once the step before is used up: (a) the window
// shrinks, which the sharing above already does; (b) the gaps tighten; (c) two
// languages step their type down; then the brand shrinks; and (d) last, the
// window is dropped (the monogram has the photo's floor, so where a photo does
// not fit, neither does it). Without the window the words take the room back at
// the roomiest step again.

/** A step as measured: the height of everything that does not flex, and the gap it keeps. */
export type MeasuredFit<T> = Readonly<{
  value: T
  gapPt: number
  /** The margins, the brand, the words and the code block together. */
  fixedPt: number
}>

export type WindowRange = Readonly<{
  /** The picture's floor and cap. */
  minPt: number
  maxPt: number
  /** The frame round the picture, top and bottom together. */
  framePt: number
}>

export type SharedHeight<T> = Readonly<{
  value: T
  gapPt: number
  /** The picture's height inside its frame; null when the face prints without a window. */
  picturePt: number | null
  /** The flexible gaps above and below the words. */
  abovePt: number
  belowPt: number
}>

/** The window and the gaps of one step on a face `heightPt` tall; null when the window does not reach its floor. */
function withWindow<T>(
  fit: MeasuredFit<T>,
  heightPt: number,
  range: WindowRange,
): SharedHeight<T> | null {
  // The fixed gap under the brand, and the two flexible gaps at their minimum.
  const room = heightPt - fit.fixedPt - 3 * fit.gapPt - range.framePt
  if (room < range.minPt) return null
  const picturePt = Math.min(range.maxPt, room)
  const spare = (room - picturePt) / 2
  return {
    value: fit.value,
    gapPt: fit.gapPt,
    picturePt,
    abovePt: fit.gapPt + spare,
    belowPt: fit.gapPt + spare,
  }
}

/** The gaps of one step with no window: the spare height shared equally, never under the minimum. */
function withoutWindow<T>(fit: MeasuredFit<T>, heightPt: number): SharedHeight<T> {
  const each = Math.max(fit.gapPt, (heightPt - fit.fixedPt) / 2)
  return {
    value: fit.value,
    gapPt: fit.gapPt,
    picturePt: null,
    abovePt: each,
    belowPt: each,
  }
}

const fitsWithoutWindow = <T>(fit: MeasuredFit<T>, heightPt: number) =>
  heightPt - fit.fixedPt >= 2 * fit.gapPt

/**
 * The first step that keeps a window at its floor, sharing the height as the
 * boards do; else, with the window dropped, the first step whose words leave the
 * gaps their minimum. Null when not even the tightest step fits: the caller then
 * shrinks the place label, the last resort.
 */
export function shareImmersiveHeight<T>(
  fits: readonly MeasuredFit<T>[],
  heightPt: number,
  range: WindowRange | null,
): SharedHeight<T> | null {
  if (range !== null) {
    for (const fit of fits) {
      const shared = withWindow(fit, heightPt, range)
      if (shared !== null) return shared
    }
  }
  const roomy = fits.find((fit) => fitsWithoutWindow(fit, heightPt))
  return roomy === undefined ? null : withoutWindow(roomy, heightPt)
}

/** The tightest step without a window, over-full or not: what the place label shrinks in. */
export function sharedWithoutWindow<T>(
  fit: MeasuredFit<T>,
  heightPt: number,
): SharedHeight<T> {
  return withoutWindow(fit, heightPt)
}
