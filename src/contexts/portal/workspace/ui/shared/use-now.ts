import { useEffect, useState } from 'react'
import { useServedNow } from '#/components/hooks/served-clock'

/**
 * The current time, refreshed on an interval, so "2 h ago" does not go stale
 * on a tab left open. It starts from the instant the server rendered the page
 * with (`useServedNow`), so the browser's first render prints what the server
 * did; the first refresh is one interval later.
 */
export function useNow(intervalMs = 60_000): Date {
  const first = useServedNow()
  const [refreshed, setRefreshed] = useState<Date | null>(null)
  useEffect(() => {
    const id = setInterval(() => setRefreshed(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return refreshed ?? first
}
