import { useEffect, useState } from 'react'

/**
 * The current time, refreshed on an interval, so "2 h ago" does not go stale
 * on a tab left open. Read once on mount (not during render of the server
 * page): nothing that shows it renders before its data has arrived.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
