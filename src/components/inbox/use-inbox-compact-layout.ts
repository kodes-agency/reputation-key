import { useSyncExternalStore } from 'react'

// 48 px app rail + 224 px queue rail + 320 px list + 6 px separator +
// 480 px detail. Below this floor the strip/sheet composition is the only one
// that can honor every panel's minimum width without horizontal overflow.
export const INBOX_DESKTOP_MIN_VIEWPORT = 1078
const INBOX_COMPACT_QUERY = `(max-width: ${INBOX_DESKTOP_MIN_VIEWPORT - 1}px)`

export function inboxUsesCompactLayout(viewportWidth: number): boolean {
  return viewportWidth < INBOX_DESKTOP_MIN_VIEWPORT
}

export function useInboxCompactLayout(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const media = window.matchMedia(INBOX_COMPACT_QUERY)
      media.addEventListener('change', onStoreChange)
      return () => media.removeEventListener('change', onStoreChange)
    },
    () => window.matchMedia(INBOX_COMPACT_QUERY).matches,
    () => false,
  )
}
