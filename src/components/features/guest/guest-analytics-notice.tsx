import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '#/components/ui/button'

const ACKNOWLEDGED_KEY = 'guest-analytics-notice-acknowledged'
const SCAN_RECORDED_KEY_PREFIX = 'guest-scan-recorded:'
const subscribeToAcknowledgement = () => () => undefined

function acknowledgementSnapshot(): boolean {
  try {
    return localStorage.getItem(ACKNOWLEDGED_KEY) === 'true'
  } catch {
    return false
  }
}

export type GuestAnalyticsNoticeProps = Readonly<{
  /** Scopes visit dedupe so each portal can record once per browser session. */
  scopeKey: string
  /** Invoked once per browser session to record the portal visit. */
  onPortalVisit: () => void | Promise<void>
}>

/**
 * Disclosure for the portal's core visit analytics. Acknowledgement controls only
 * whether the notice is shown again; it never enables or disables measurement.
 */
export function GuestAnalyticsNotice({
  scopeKey,
  onPortalVisit,
}: GuestAnalyticsNoticeProps) {
  const acknowledged = useSyncExternalStore(
    subscribeToAcknowledgement,
    acknowledgementSnapshot,
    () => true,
  )
  const [dismissed, setDismissed] = useState(false)
  const notifiedThisMount = useRef(false)

  const recordPortalVisit = useCallback(() => {
    if (notifiedThisMount.current) return
    notifiedThisMount.current = true
    const recordedKey = `${SCAN_RECORDED_KEY_PREFIX}${scopeKey}`
    try {
      if (sessionStorage.getItem(recordedKey) === 'recorded') return
      // A stale `pending` marker means the prior page closed before confirmation;
      // retry it. The in-memory guard prevents React effect duplication.
      sessionStorage.setItem(recordedKey, 'pending')
    } catch {
      // Storage may be unavailable in hardened browsers. The in-memory guard still
      // protects this mount; the server owns authoritative dedupe and abuse control.
    }
    void Promise.resolve()
      .then(onPortalVisit)
      .then(() => {
        try {
          sessionStorage.setItem(recordedKey, 'recorded')
        } catch {
          // The server remains the authoritative idempotency boundary.
        }
      })
      .catch(() => {
        try {
          if (sessionStorage.getItem(recordedKey) === 'pending') {
            sessionStorage.removeItem(recordedKey)
          }
        } catch {
          // A future mount can still retry when storage is unavailable.
        }
      })
  }, [scopeKey, onPortalVisit])

  useEffect(() => {
    recordPortalVisit()
  }, [recordPortalVisit])

  const acknowledge = () => {
    try {
      localStorage.setItem(ACKNOWLEDGED_KEY, 'true')
    } catch {
      // The notice can still be dismissed for this page if storage is unavailable.
    }
    setDismissed(true)
  }

  if (acknowledged || dismissed) return null

  return (
    <div
      role="region"
      aria-label="Portal analytics information"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background p-4"
    >
      <div className="mx-auto flex max-w-lg flex-col gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">
          An essential session cookie protects your response. Separately, we count this
          visit using a short-lived, privacy-protected network marker. This helps the
          property understand how its review portal is performing and prevents duplicate
          activity.
        </p>
        <div className="flex shrink-0 justify-end">
          <Button size="sm" onClick={acknowledge}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  )
}
