// "Show" on a change brings the part of the page it changed into view in the
// phones. The page is laid out at a real phone's width and scaled with a
// transform, so a part's distance from the top is measured on screen and
// divided by the scale to get the page's own pixels.

import type { ReviewPreviewPart } from './portal-review-changes'

/** The scroll position, in the page's own pixels, that puts a part at the top of its frame. */
export function scrollTopForPart(
  frame: Readonly<{ top: number; scrollTop: number }>,
  part: Readonly<{ top: number }> | null,
  scale: number,
): number {
  if (part === null) return 0
  return Math.max(0, Math.round((part.top - frame.top) / scale + frame.scrollTop))
}

/** The breathing room kept above a part, in the page's own pixels. */
const PART_MARGIN = 24

export function showPartInPhones(
  container: HTMLElement,
  part: ReviewPreviewPart,
  scale: number,
  prefersReducedMotion: boolean,
): void {
  const frames = container.querySelectorAll<HTMLElement>('[role="region"]')
  for (const frame of frames) {
    const target =
      part === 'top'
        ? null
        : frame.querySelector<HTMLElement>(`[data-preview-part="${part}"]`)
    const top = scrollTopForPart(
      { top: frame.getBoundingClientRect().top, scrollTop: frame.scrollTop },
      target === null ? null : { top: target.getBoundingClientRect().top },
      scale,
    )
    frame.scrollTo({
      top: Math.max(0, top - PART_MARGIN),
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    })
  }
}
