// Inbox composer — putting the caret in region 4 without moving the pane.
//
// Both of the obvious ways to reveal a field walk EVERY scrollable ancestor:
// `focus()` does it unless told not to, and `scrollIntoView` does it always.
// The pane's column is `overflow: hidden`, which is still programmatically
// scrollable, so either of them can scroll region 1 (the header: Close detail,
// Escalate / Resolve, the copy menu) and region 2 (the case strip) off the top
// of a box with no scrollbar, no wheel and no touch to bring them back —
// measured at 60–118 px on the reply half's `scrollIntoView`, and it stayed
// there. Region 4 is a scroller of its own, so the caret moves THAT box and
// nothing above it.

/** The nearest ancestor that actually scrolls vertically right now, or null. */
function nearestScroller(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent)
    const scrolls = overflowY === 'auto' || overflowY === 'scroll'
    if (scrolls && parent.scrollHeight > parent.clientHeight) return parent
  }
  return null
}

/**
 * Focus `field` and, only if it is out of view, scroll the one box that owns
 * it — by the smallest amount that brings it back, which is `block: 'nearest'`
 * without `scrollIntoView`'s licence to move everything else too.
 */
export function putCaretIn(field: HTMLElement): void {
  field.focus({ preventScroll: true })
  const scroller = nearestScroller(field)
  if (scroller === null) return
  const view = scroller.getBoundingClientRect()
  const box = field.getBoundingClientRect()
  if (box.top >= view.top && box.bottom <= view.bottom) return
  scroller.scrollTop += box.top < view.top ? box.top - view.top : box.bottom - view.bottom
}
