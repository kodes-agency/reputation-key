// A visible cue when something urgent arrives while the bell is closed (D9,
// docs/design/notifications). The badge moving by one was the only sign, up to
// a poll late; the announcement reached screen readers only.
//
// Only what is on a clock — urgent, or past its Response Target — and still
// waiting earns a toast, and only when it was created after everything the
// reader was already shown. A row can join the Needs-you head without being
// new: an older one moves up from the backlog when another is answered, or the
// reader marks one unread or undoes a dismiss. Creation time tells those apart
// where "not listed before" cannot. The first snapshot of an Organization only
// seeds.

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import {
  isStillWaiting,
  type NotificationView,
} from '#/contexts/feed/application/public-api'
import { isOnAClock } from './notification-filters'

/** The creation time of the newest row the reader was shown; null before any. */
type Newest = number | null

const newestOf = (newest: Newest, rows: ReadonlyArray<NotificationView>): Newest =>
  rows.reduce<Newest>((max, row) => {
    const at = row.createdAt.getTime()
    return max === null || at > max ? at : max
  }, newest)

/** The rows on a clock, still waiting, and created after `newest`. */
export function newUrgentArrivals(
  newest: Newest,
  rows: ReadonlyArray<NotificationView>,
): ReadonlyArray<NotificationView> {
  return rows.filter(
    (row) =>
      (newest === null || row.createdAt.getTime() > newest) &&
      isStillWaiting(row) &&
      isOnAClock(row),
  )
}

/** What the toast says: one arrival by its property, several by their count. */
export function urgentArrivalMessage(arrivals: ReadonlyArray<NotificationView>): string {
  if (arrivals.length !== 1) return `${arrivals.length} urgent notifications need you`
  const property = arrivals[0]!.payload.propertyName
  return property === undefined
    ? 'Something urgent needs you'
    : `Something urgent needs you at ${property}`
}

type Options = Readonly<{
  /** The Organization the rows belong to; a new one seeds again. */
  scope: string
  /** The Needs-you head: the rows the badge counts. */
  rows: ReadonlyArray<NotificationView>
  /** The head has answered for this scope. */
  ready: boolean
  /** The bell is open: the reader is looking at the list already. */
  bellOpen: boolean
  openBell: () => void
}>

export function useUrgentArrivalToasts({
  scope,
  rows,
  ready,
  bellOpen,
  openBell,
}: Options): void {
  const shown = useRef<Readonly<{ scope: string; newest: Newest }> | null>(null)
  useEffect(() => {
    if (!ready) return
    const previous = shown.current
    const isSameScope = previous !== null && previous.scope === scope
    shown.current = {
      scope,
      newest: newestOf(isSameScope ? previous.newest : null, rows),
    }
    if (!isSameScope || bellOpen) return
    const arrivals = newUrgentArrivals(previous.newest, rows)
    if (arrivals.length === 0) return
    toast(urgentArrivalMessage(arrivals), {
      action: { label: 'Open', onClick: openBell },
    })
  }, [scope, rows, ready, bellOpen, openBell])
}
