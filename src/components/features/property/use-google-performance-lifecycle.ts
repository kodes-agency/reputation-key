import { useEffect, useState } from 'react'

export type PerformanceClearReason =
  | 'content_expired'
  | 'authorization_lost'
  | 'lifecycle'

type ClearPerformance = (reason: PerformanceClearReason) => void

export function usePageVisibleAndFocused(): boolean {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const update = () =>
      setActive(document.visibilityState === 'visible' && document.hasFocus())
    update()
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
    }
  }, [])

  return active
}

export function useClearPerformanceOnLifecycle(
  hydrated: boolean,
  clear: ClearPerformance,
): void {
  useEffect(() => {
    if (!hydrated) return
    const clearForLifecycle = () => clear('lifecycle')
    const clearWhenHidden = () => {
      if (document.visibilityState === 'hidden') clearForLifecycle()
    }
    document.addEventListener('visibilitychange', clearWhenHidden)
    document.addEventListener('freeze', clearForLifecycle)
    window.addEventListener('pagehide', clearForLifecycle)
    return () => {
      document.removeEventListener('visibilitychange', clearWhenHidden)
      document.removeEventListener('freeze', clearForLifecycle)
      window.removeEventListener('pagehide', clearForLifecycle)
    }
  }, [clear, hydrated])
}

function useExpiryDeadline(
  expiresAt: string | null,
  reason: PerformanceClearReason,
  clearReason: PerformanceClearReason | null,
  clear: ClearPerformance,
): void {
  useEffect(() => {
    if (expiresAt === null || clearReason !== null) return
    const remainingMs = new Date(expiresAt).getTime() - Date.now()
    if (remainingMs <= 0) {
      clear(reason)
      return
    }
    const timeout = window.setTimeout(() => clear(reason), remainingMs)
    return () => window.clearTimeout(timeout)
  }, [clear, clearReason, expiresAt, reason])
}

export function usePerformanceExpiry(
  contentExpiresAt: string | null,
  leaseExpiresAt: string | null,
  clearReason: PerformanceClearReason | null,
  clear: ClearPerformance,
): void {
  useExpiryDeadline(contentExpiresAt, 'content_expired', clearReason, clear)
  useExpiryDeadline(leaseExpiresAt, 'authorization_lost', clearReason, clear)
}

export function useRetryCountdown(retryAvailableAt: number): number {
  const [clock, setClock] = useState(() => Date.now())

  useEffect(() => {
    if (retryAvailableAt <= Date.now()) return
    const interval = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [retryAvailableAt])

  return Math.max(0, Math.ceil((retryAvailableAt - clock) / 1_000))
}
