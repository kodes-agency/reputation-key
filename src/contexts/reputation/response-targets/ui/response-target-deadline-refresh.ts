import { useEffect } from 'react'
import type { ResponseTargetView } from '#/contexts/inbox/application/public-api'

const MAX_TIMEOUT_MS = 2_147_000_000

export function responseTargetDeadlineRefreshAt(
  target: ResponseTargetView | null | undefined,
): Date | null {
  return target?.evaluation.state === 'active' && !target.evaluation.overdue
    ? target.dueAt
    : null
}

/**
 * Schedule one refresh at an absolute target deadline. Long targets are
 * rechecked in safe timer-sized chunks so a browser timeout never overflows.
 */
export function scheduleResponseTargetDeadlineRefresh(
  input: Readonly<{
    dueAt: Date
    refresh: () => void
  }>,
): () => void {
  const dueAtMs = input.dueAt.getTime()
  if (!Number.isFinite(dueAtMs)) {
    throw new TypeError('Response target due time must be a valid Date')
  }

  let cancelled = false
  let timeout: ReturnType<typeof setTimeout> | null = null
  const schedule = () => {
    if (cancelled) return
    const remainingMs = dueAtMs - Date.now()
    if (remainingMs <= 0) {
      cancelled = true
      input.refresh()
      return
    }
    timeout = setTimeout(schedule, Math.min(remainingMs, MAX_TIMEOUT_MS))
  }

  schedule()
  return () => {
    cancelled = true
    if (timeout !== null) clearTimeout(timeout)
  }
}

/** Keep an open detail card accurate when its read-time deadline is crossed. */
export function useTargetDeadlineRefresh(
  enabled: boolean,
  target: ResponseTargetView | null | undefined,
  refresh: () => unknown,
): void {
  const refreshAtMs = enabled
    ? (responseTargetDeadlineRefreshAt(target)?.getTime() ?? null)
    : null

  useEffect(() => {
    if (refreshAtMs === null) return
    return scheduleResponseTargetDeadlineRefresh({
      dueAt: new Date(refreshAtMs),
      refresh: () => {
        void refresh()
      },
    })
  }, [refresh, refreshAtMs])
}
