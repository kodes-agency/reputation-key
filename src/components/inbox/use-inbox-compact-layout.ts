import { useViewportBelow } from '#/components/hooks/use-viewport-below'

// 48 px app rail + 224 px queue rail + 320 px list + 6 px separator +
// 480 px detail. Below this floor the strip/sheet composition is the only one
// that can honor every panel's minimum width without horizontal overflow.
const INBOX_DESKTOP_MIN_VIEWPORT = 1078

export function inboxUsesCompactLayout(viewportWidth: number): boolean {
  return viewportWidth < INBOX_DESKTOP_MIN_VIEWPORT
}

export function useInboxCompactLayout(): boolean {
  return useViewportBelow(INBOX_DESKTOP_MIN_VIEWPORT)
}
