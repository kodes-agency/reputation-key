// What the app shell keeps when React replaces it.
//
// A refusal, or a Property that is not there, is drawn by the shell route's
// not-found boundary, and a boundary replaces its route's component: the layout
// unmounts and the boundary brings a shell of its own. State held in the layout
// would reset with it, so what a person has set is kept here, outside the tree:
//
//   - whether the sidebar is open, or a collapsed sidebar opens again;
//   - which sidebar link has focus, or keyboard focus falls to <body> and the next
//     Tab starts again from the top of the page.
//
// Nothing here is read on the server: the sidebar starts open, and nothing sets
// it until a person acts in the browser.
import { useLayoutEffect, useSyncExternalStore } from 'react'

let sidebarOpen = true
const listeners = new Set<() => void>()

/** The store behind `useSidebarOpen`; exported so its rules are tested without React. */
export const sidebarStore = {
  get: (): boolean => sidebarOpen,
  set(next: boolean): void {
    if (next === sidebarOpen) return
    sidebarOpen = next
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** Whether the sidebar is open, and how to change it; it survives the shell being replaced. */
export function useSidebarOpen(): readonly [boolean, (next: boolean) => void] {
  const open = useSyncExternalStore(sidebarStore.subscribe, sidebarStore.get, () => true)
  return [open, sidebarStore.set]
}

/** The sidebar link that had focus when a shell went, for the shell that follows it. */
let handoff: Readonly<{ href: string; at: number }> | null = null

/**
 * How long a focus note waits for the next shell. Between a shell that goes and
 * the one that replaces it the router may draw its pending state for a loader's
 * duration, so the next shell is not always in the same commit. A shell that
 * goes for good (signing out) is not followed by one within seconds.
 */
const HANDOFF_MS = 3000

const SIDEBAR_LINK = '[data-slot="sidebar-menu-button"]'

function focusedSidebarHref(): string | null {
  const active = document.activeElement
  const link = active instanceof Element ? active.closest(SIDEBAR_LINK) : null
  return link?.getAttribute('href') ?? null
}

function restoreFocus(): void {
  const note = handoff
  handoff = null
  if (note === null || Date.now() - note.at > HANDOFF_MS) return
  for (const link of document.querySelectorAll<HTMLElement>(SIDEBAR_LINK)) {
    if (link.getAttribute('href') === note.href) {
      link.focus()
      return
    }
  }
}

/**
 * Hands keyboard focus from the shell that unmounts to the one that replaces it:
 * the sidebar link that had it.
 */
export function useKeepSidebarFocus(): void {
  useLayoutEffect(() => {
    restoreFocus()
    return () => {
      const href = focusedSidebarHref()
      handoff = href === null ? null : { href, at: Date.now() }
    }
  }, [])
}
