import { createContext, useContext, useState } from 'react'
import { useHydrated } from './use-hydrated'

/**
 * The clock reading the server rendered the page with, carried on `<html>` so
 * the browser's first render can start from the same instant. Text that says
 * how long ago something was ("just now", "3 min ago", "yesterday") is a
 * function of the clock: a browser that hydrated with its own reading, even a
 * few seconds later, printed a different word than the server did (React #418).
 */
export const SERVED_AT_ATTRIBUTE = 'data-served-at'

/** The server's own reading, or the one it stamped on `<html>` for the browser. */
export function readServedAt(): number {
  if (typeof document === 'undefined') return Date.now()
  const stamped = Number(document.documentElement.getAttribute(SERVED_AT_ATTRIBUTE))
  return Number.isFinite(stamped) && stamped > 0 ? stamped : Date.now()
}

/** The one reading a document is stamped with: the server's, then the browser's copy of it. */
export function useServedAt(): number {
  const [servedAt] = useState(readServedAt)
  return servedAt
}

/** The attribute for `<html>` that carries the reading to the browser. */
export const servedAtProps = (servedAt: number) => ({
  [SERVED_AT_ATTRIBUTE]: servedAt,
})

export const ServedClockContext = createContext<number | null>(null)

/**
 * The current time for a page, read once when it mounts. While the server
 * renders and while the browser hydrates that render it is the server's
 * reading; a page the browser mounts later (a client-side navigation) starts
 * from the browser's own clock.
 */
export function useServedNow(): Date {
  const served = useContext(ServedClockContext)
  const hydrated = useHydrated()
  const [now] = useState(() =>
    hydrated || served === null ? new Date() : new Date(served),
  )
  return now
}
