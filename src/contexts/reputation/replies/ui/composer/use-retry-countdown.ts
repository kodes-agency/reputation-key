import { useEffect, useState } from 'react'

/**
 * Whole seconds until `retryAtEpochMillis`, ticking once a second and stopping
 * at zero. The clock is read when the component mounts, so render the consumer
 * with `key={retryAtEpochMillis}`: a new retry time is a new countdown.
 */
export function useRetryCountdown(retryAtEpochMillis: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= retryAtEpochMillis) window.clearInterval(timer)
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [retryAtEpochMillis])

  return Math.max(0, Math.ceil((retryAtEpochMillis - now) / 1_000))
}
