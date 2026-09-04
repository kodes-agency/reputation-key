import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '#/components/ui/button'
import {
  getGuestPortalCopy,
  type GuestPortalLanguagePackVersion,
  type GuestPortalLocale,
} from './public-portal/guest-language-pack'

const ACKNOWLEDGED_KEY = 'guest-analytics-notice-acknowledged'
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

const subscribeToAcknowledgement = () => () => undefined

function acknowledgementSnapshot(): boolean {
  try {
    return localStorage.getItem(ACKNOWLEDGED_KEY) === 'true'
  } catch {
    return false
  }
}

export type GuestAnalyticsNoticeProps = Readonly<{
  /** Stable Portal identity used to separate visits to different Portals. */
  scopeKey: string
  /** Signed-session identity used to separate successive guests in one browser tab. */
  sessionKey: string
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

export async function settlePortalVisitOnce({
  storage,
  scopeKey,
  sessionKey,
  onPortalVisit,
}: Readonly<{
  storage: PortalVisitStorage
  scopeKey: string
  sessionKey: string
  onPortalVisit: GuestAnalyticsNoticeProps['onPortalVisit']
}>): Promise<void> {
  const recordedKey = portalVisitStorageKey(scopeKey, sessionKey)
  try {
    if (storage.getItem(recordedKey) === 'recorded') return
    // A stale `pending` marker means the prior page closed before confirmation;
    // retry it. The component's in-memory guard prevents effect duplication.
    storage.setItem(recordedKey, 'pending')
  } catch {
    // Storage may be unavailable in hardened browsers. The component's in-memory
    // guard still protects this mount; the server owns authoritative dedupe.
  }

  const settled = await settlePortalVisit(onPortalVisit)
  try {
    if (settled) storage.setItem(recordedKey, 'recorded')
    else if (storage.getItem(recordedKey) === 'pending') {
      storage.removeItem(recordedKey)
    }
  } catch {
    // A future mount can still retry when storage is unavailable.
  }
}

/**
 * Disclosure for the portal's core visit analytics. Acknowledgement controls only
 * whether the notice is shown again; it never enables or disables measurement.
 */
export function GuestAnalyticsNotice({
  scopeKey,
  sessionKey,
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
    void settlePortalVisitOnce({
      storage: sessionStorage,
      scopeKey,
      sessionKey,
      onPortalVisit,
    })
  }, [scopeKey, sessionKey, onPortalVisit])

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
