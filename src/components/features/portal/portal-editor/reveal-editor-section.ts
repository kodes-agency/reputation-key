// Bringing a section into view after a click on the preview opened it. Below
// `lg` the preview stacks under the form, so the click happens far below the
// section it opens: without this only the outline in the phone moves, and the
// new form is a scroll away, out of sight.

/**
 * Whether the top of the opened section is out of sight in its scroll area: above
 * it, or so far down that it is not in the upper half where a person looks for
 * what just opened. Positions are viewport pixels.
 */
export function needsReveal(
  sectionTop: number,
  area: Readonly<{ top: number; height: number }>,
): boolean {
  return sectionTop < area.top || sectionTop > area.top + area.height / 2
}

/** Room left above the section once it is brought up, so it does not touch the edge. */
const REVEAL_GAP_PX = 16

/** The nearest ancestor that scrolls vertically: the workspace body. */
function scrollArea(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

/**
 * Scroll the workspace body so the opened section's top is in view when it is
 * out of sight, and move focus to its heading so a keyboard or screen-reader
 * user lands where the click led. Only the body scrolls (`scrollIntoView` would
 * move every scrolling ancestor). Runs after the next paint: the section has
 * just been swapped in by the navigation.
 */
export function revealEditorSection(section: HTMLElement | null): void {
  if (section === null) return
  requestAnimationFrame(() => {
    const area = scrollArea(section)
    if (area !== null) {
      const bounds = area.getBoundingClientRect()
      const top = section.getBoundingClientRect().top
      if (needsReveal(top, bounds)) {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        area.scrollTo({
          top: area.scrollTop + top - bounds.top - REVEAL_GAP_PX,
          behavior: reduced ? 'auto' : 'smooth',
        })
      }
    }
    section.querySelector<HTMLElement>('h2[tabindex]')?.focus({ preventScroll: true })
  })
}
