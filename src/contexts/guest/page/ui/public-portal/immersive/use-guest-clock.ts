import { useEffect, useRef, useState } from 'react'
import { advanceServedAt } from './guest-clock'

/**
 * The instant the page reads its deadlines against. It is `servedAt` for the
 * server render and the first browser render, then follows the time the page
 * has been open, re-read whenever `refreshOn` changes (a response the server
 * just returned), so a deadline that passed while the guest read the page is
 * shown as ended.
 */
export function useGuestClock(servedAt: string, refreshOn: unknown): string {
  const [now, setNow] = useState(servedAt)
  const openedAt = useRef<{ servedAt: string; at: number } | null>(null)

  useEffect(() => {
    if (openedAt.current === null || openedAt.current.servedAt !== servedAt) {
      openedAt.current = { servedAt, at: Date.now() }
    }
    setNow(advanceServedAt(servedAt, Date.now() - openedAt.current.at))
  }, [servedAt, refreshOn])

  return now
}
