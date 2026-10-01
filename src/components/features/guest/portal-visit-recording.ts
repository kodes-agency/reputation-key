import { useCallback, useEffect, useRef } from 'react'

const SCAN_RECORDED_KEY_PREFIX = 'guest-scan-recorded:'

type PortalVisitStorage = Readonly<{
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}>

// A prior page can settle after its storage was cleared and a replacement
// signed session started. Keep its late marker isolated from the new session.
export function portalVisitStorageKey(scopeKey: string, sessionKey: string): string {
  return `${SCAN_RECORDED_KEY_PREFIX}${scopeKey}:${sessionKey}`
}

/** What a portal page does to record one visit; see `settlePortalVisit` for the outcomes. */
export type PortalVisitRecorder = () =>
  | void
  | 'recorded'
  | 'settled'
  | 'retryable'
  | Promise<void | 'recorded' | 'settled' | 'retryable'>

const RETRY_DELAYS_MS = [1_000] as const

/**
 * Make one bounded retry for a transient observation failure. A confirmed
 * ineligible/direct visit is settled without retry; an exhausted transient
 * failure remains pending so a later page load can try again.
 */
export async function settlePortalVisit(
  attempt: PortalVisitRecorder,
  wait: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise((resolve) => setTimeout(resolve, delayMs)),
): Promise<boolean> {
  for (let attemptIndex = 0; attemptIndex <= RETRY_DELAYS_MS.length; attemptIndex++) {
    try {
      const outcome = await attempt()
      if (outcome !== 'retryable') return true
    } catch {
      // A transport failure has no authoritative settlement; retry once.
    }
    const delayMs = RETRY_DELAYS_MS[attemptIndex]
    if (delayMs === undefined) return false
    await wait(delayMs)
  }
  return false
}

export async function settlePortalVisitOnce({
  storage,
  scopeKey,
  sessionKey,
  onPortalVisit,
}: Readonly<{
  storage: PortalVisitStorage | null
  scopeKey: string
  sessionKey: string
  onPortalVisit: PortalVisitRecorder
}>): Promise<void> {
  const recordedKey = portalVisitStorageKey(scopeKey, sessionKey)
  if (storage !== null) {
    try {
      if (storage.getItem(recordedKey) === 'recorded') return
      // A stale `pending` marker means the prior page closed before confirmation;
      // retry it. The component's in-memory guard prevents effect duplication.
      storage.setItem(recordedKey, 'pending')
    } catch {
      // Storage may be unavailable in hardened browsers. The component's in-memory
      // guard still protects this mount; the server owns authoritative dedupe.
    }
  }

  const settled = await settlePortalVisit(onPortalVisit)
  if (storage !== null) {
    try {
      if (settled) storage.setItem(recordedKey, 'recorded')
      else if (storage.getItem(recordedKey) === 'pending') {
        storage.removeItem(recordedKey)
      }
    } catch {
      // A future mount can still retry when storage is unavailable.
    }
  }
}

export async function settlePortalVisitFromStorage({
  getStorage = () => sessionStorage,
  scopeKey,
  sessionKey,
  onPortalVisit,
}: Readonly<{
  getStorage?: () => PortalVisitStorage
  scopeKey: string
  sessionKey: string
  onPortalVisit: PortalVisitRecorder
}>): Promise<void> {
  let storage: PortalVisitStorage | null = null
  try {
    storage = getStorage()
  } catch {
    // Accessing the Storage object itself can throw in hardened browsers.
  }
  await settlePortalVisitOnce({
    storage,
    scopeKey,
    sessionKey,
    onPortalVisit,
  })
}

/**
 * Records the portal visit once per mount. It reads nothing about the visit
 * notice: acknowledging, dismissing or never seeing the notice cannot change
 * whether a visit is counted. Both guest renderers call this, whatever notice
 * they show.
 */
export function usePortalVisitRecording({
  scopeKey,
  sessionKey,
  onPortalVisit,
}: Readonly<{
  scopeKey: string
  sessionKey: string
  onPortalVisit: PortalVisitRecorder
}>): void {
  const notifiedThisMount = useRef(false)

  const recordPortalVisit = useCallback(() => {
    if (notifiedThisMount.current) return
    notifiedThisMount.current = true
    void settlePortalVisitFromStorage({ scopeKey, sessionKey, onPortalVisit })
  }, [scopeKey, sessionKey, onPortalVisit])

  useEffect(() => {
    recordPortalVisit()
  }, [recordPortalVisit])
}
