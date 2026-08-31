import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '#/components/ui/button'
import {
  getGuestPortalCopy,
  type GuestPortalLanguagePackVersion,
  type GuestPortalLocale,
} from './public-portal/guest-language-pack'

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
  locale?: GuestPortalLocale
  languagePackVersion?: GuestPortalLanguagePackVersion
  /** Invoked once per browser session to record the portal visit. */
  onPortalVisit: () =>
    | void
    | 'recorded'
    | 'settled'
    | 'retryable'
    | Promise<void | 'recorded' | 'settled' | 'retryable'>
}>

const RETRY_DELAYS_MS = [1_000] as const

/**
 * Make one bounded retry for a transient observation failure. A confirmed
 * ineligible/direct visit is settled without retry; an exhausted transient
 * failure remains pending so a later page load can try again.
 */
export async function settlePortalVisit(
  attempt: GuestAnalyticsNoticeProps['onPortalVisit'],
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

/**
 * Disclosure for the portal's core visit analytics. Acknowledgement controls only
 * whether the notice is shown again; it never enables or disables measurement.
 */
export function GuestAnalyticsNotice({
  scopeKey,
  onPortalVisit,
  locale = 'en',
  languagePackVersion = locale === 'bg' ? 'guest-ui-bg-v1' : 'guest-ui-en-v1',
}: GuestAnalyticsNoticeProps) {
  const copy = getGuestPortalCopy(locale, languagePackVersion)
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
    void settlePortalVisit(onPortalVisit)
      .then((settled) => {
        try {
          if (settled) sessionStorage.setItem(recordedKey, 'recorded')
          else if (sessionStorage.getItem(recordedKey) === 'pending') {
            sessionStorage.removeItem(recordedKey)
          }
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
      aria-label={copy.analyticsLabel}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background p-4"
    >
      <div className="mx-auto flex max-w-lg flex-col gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">{copy.analyticsBody}</p>
        <div className="flex shrink-0 justify-end">
          <Button size="sm" onClick={acknowledge}>
            {copy.analyticsAcknowledge}
          </Button>
        </div>
      </div>
    </div>
  )
}
