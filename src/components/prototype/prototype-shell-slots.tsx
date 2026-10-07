// PROTOTYPE — delete with the prototype it serves. Lets a throwaway page change two
// things about the authenticated shell it sits in, without the shell knowing which
// page it is: drop the page gutter and collapse the sidebar to its icon rail
// (`fullBleed`, as the Portal workspace does), or replace the app sidebar's content
// (`sidebar`). The shell reads `usePrototypeShellSlots()`; a page asks with
// `usePrototypeShell()`, and its request is withdrawn when the page unmounts. The
// shell renders without the request on the server, so a page that asks shows the
// padded shell for one frame on a full load.
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'

export type PrototypeShellSlots = Readonly<{
  fullBleed: boolean
  sidebar: ReactNode
}>

const NONE: PrototypeShellSlots = { fullBleed: false, sidebar: null }

let current: PrototypeShellSlots = NONE
const listeners = new Set<() => void>()

function publish(next: PrototypeShellSlots) {
  if (next.fullBleed === current.fullBleed && next.sidebar === current.sidebar) return
  current = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** For the authenticated shell: what the open prototype page asked for. */
export function usePrototypeShellSlots(): PrototypeShellSlots {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => NONE,
  )
}

/** For a prototype page: ask the shell to go full bleed and/or show this sidebar. */
export function usePrototypeShell(request: Partial<PrototypeShellSlots>): void {
  const fullBleed = request.fullBleed ?? false
  const sidebar = request.sidebar ?? null
  useEffect(() => {
    publish({ fullBleed, sidebar })
  }, [fullBleed, sidebar])
  useEffect(() => () => publish(NONE), [])
}
