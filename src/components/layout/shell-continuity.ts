// What the app shell keeps when React replaces it.
//
// A refusal, or a Property that is not there, is drawn by the shell route's
// not-found boundary, and a boundary replaces its route's component: the layout
// unmounts and the boundary brings a shell of its own. State held in the layout
// would reset with it, so what a person has set is kept here, outside the tree:
//
//   - whether the sidebar is open, or a collapsed sidebar opens again;
//   - the last app page they were on, so "Back to app" in Settings goes back to it;
//   - which sidebar link has focus, or keyboard focus falls to <body> and the next
//     Tab starts again from the top of the page.
//
// The sidebar choice outlives the tab as well: it is the `sidebar_state` cookie,
// which the browser store starts from and writes on each toggle, and which the
// server reads with the request (see `sidebar-cookie`). The server never reads this
// store; it draws the shell from the loader's copy of the same cookie
// (`useSidebarOpen`'s argument), so the first frame and the hydrated one agree.
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { useRenderedLocation } from './rendered-location'
import { sidebarCookie, sidebarOpenFromCookie } from './sidebar-cookie'

export type SidebarStore = Readonly<{
  get: () => boolean
  set: (next: boolean) => void
  subscribe: (listener: () => void) => () => void
}>

/**
 * A sidebar-open store that starts at `initial` and tells `persist` about each
 * change. Exported so its rules are tested without React or a browser.
 */
export function createSidebarStore(
  initial: boolean,
  persist: (open: boolean) => void,
): SidebarStore {
  let open = initial
  const listeners = new Set<() => void>()
  return {
    get: () => open,
    set(next) {
      if (next === open) return
      open = next
      persist(next)
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function hasDocument(): boolean {
  return typeof document !== 'undefined'
}

function rememberInCookie(open: boolean): void {
  if (!hasDocument()) return
  document.cookie = sidebarCookie(open, window.location.protocol === 'https:')
}

/** The store behind `useSidebarOpen`; the browser's copy of the cookie the server read. */
export const sidebarStore = createSidebarStore(
  hasDocument() ? (sidebarOpenFromCookie(document.cookie) ?? true) : true,
  rememberInCookie,
)

/**
 * Whether the sidebar is open, and how to change it; it survives the shell being
 * replaced. `serverOpen` is what the server (and hydration) draws: the loader's
 * reading of the cookie, so the browser's first render answers as the server did.
 */
export function useSidebarOpen(
  serverOpen = true,
): readonly [boolean, (next: boolean) => void] {
  const open = useSyncExternalStore(
    sidebarStore.subscribe,
    sidebarStore.get,
    () => serverOpen,
  )
  return [open, sidebarStore.set]
}

export type AppLocation = Readonly<{
  pathname: string
  search: Readonly<Record<string, unknown>>
}>

let lastAppLocation: AppLocation | null = null
/** Whose page `lastAppLocation` is: the person and organization it was seen under. */
let lastOwner = ''

const SETTINGS_PATH = /^\/settings(?:\/|$)/u

/**
 * The last page outside Settings that was on screen in this tab, for `owner`; or
 * `null` before one, and after the person or the organization changed (another
 * person's Inbox item, or another organization's Property, is not a place to go back to).
 */
export const appLocationStore = {
  get: (owner = ''): AppLocation | null => (owner === lastOwner ? lastAppLocation : null),
  /** Remembers `location` unless it is a Settings page, which is what we came from. */
  remember(location: AppLocation, owner = ''): void {
    if (owner !== lastOwner) {
      lastOwner = owner
      lastAppLocation = null
    }
    if (SETTINGS_PATH.test(location.pathname)) return
    lastAppLocation = location
  },
}

/** Who "Back to app" belongs to: the signed-in person and the active organization. */
export function useAppLocationOwner(): string {
  const ctx = useRouteContext({ from: '/_authenticated' }) as Readonly<{
    user?: Readonly<{ id?: string }>
    activeOrganization?: Readonly<{ id?: string }> | null
  }>
  return `${ctx.user?.id ?? ''}:${ctx.activeOrganization?.id ?? ''}`
}

/**
 * Notes the page on screen as the one "Back to app" returns to. In the shell, so
 * it follows the rendered page; module memory, so it lasts for the tab and a hard
 * load of Settings (which has no page before it) falls back to the Properties list.
 */
export function useRememberAppLocation(): void {
  const { pathname, search } = useRenderedLocation()
  const owner = useAppLocationOwner()
  useEffect(() => {
    appLocationStore.remember(
      {
        pathname,
        search: typeof search === 'object' && search !== null ? { ...search } : {},
      },
      owner,
    )
  }, [pathname, search, owner])
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
