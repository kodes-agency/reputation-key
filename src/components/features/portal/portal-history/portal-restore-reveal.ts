// Where the inline "Make version 4 live again?" confirmation lands on a phone.
// It opens under a row near the fold and can be taller than the window. The
// question must stay on screen: when the whole confirmation fits, bring the
// buttons that answer it into view; when it does not, keep its heading at the
// top rather than scroll the question away. The dialog host (focusOnOpen off)
// swaps its content for the confirmation and keeps the scroll of the page it
// replaced, which put the question above the visible top: it starts at the
// confirmation instead.

type Scrollable = {
  getBoundingClientRect: () => { height: number }
  scrollIntoView?: (options: ScrollIntoViewOptions) => void
}

type Parts = Readonly<{
  section: Scrollable | null
  heading: Scrollable | null
  actions: Scrollable | null
}>

type Options = Readonly<{ focusOnOpen: boolean; viewportHeight: number }>

/** Instant: no animated scroll for anyone who asked for less motion. */
const INSTANT = 'instant' as const

export function revealRestoreConfirmation(
  { section, heading, actions }: Parts,
  { focusOnOpen, viewportHeight }: Options,
): void {
  if (section === null) return
  if (!focusOnOpen) {
    section.scrollIntoView?.({ block: 'start', behavior: INSTANT })
    return
  }
  if (section.getBoundingClientRect().height <= viewportHeight) {
    actions?.scrollIntoView?.({ block: 'nearest', behavior: INSTANT })
    return
  }
  heading?.scrollIntoView?.({ block: 'start', behavior: INSTANT })
}
