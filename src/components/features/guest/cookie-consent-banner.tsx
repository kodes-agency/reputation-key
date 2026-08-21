import { useState, useEffect, useCallback } from 'react'
import { Button } from '#/components/ui/button'

const CONSENT_KEY = 'guest-analytics-consent'
const SCAN_RECORDED_KEY_PREFIX = 'guest-scan-recorded:'

type ConsentDecision = 'granted' | 'denied'

export type CookieConsentBannerProps = Readonly<{
  /**
   * Scopes the once-per-session guard, so a guest who opens two portals in one
   * browser session records one scan per portal rather than one in total.
   */
  scopeKey: string
  /** Invoked once per browser session while analytics consent is in force. */
  onAnalyticsConsent: () => void
}>

/**
 * Guest analytics consent.
 *
 * `portal.scan` requires `analyticsConsent: z.literal(true)` (see `recordScanSchema`
 * in `contexts/guest/server/guest-scans.ts`), so this banner has to collect an
 * explicit decision — a dismiss-only notice satisfies nothing and left `portal.scan`
 * permanently 0. Reject is offered as prominently as Accept, and the copy discloses
 * the salted IP hash the scan and response paths persist: a hashed IP is
 * pseudonymised personal data under GDPR, not anonymous, so the previous "No
 * personal data is collected" claim was untrue.
 */
export function CookieConsentBanner({
  scopeKey,
  onAnalyticsConsent,
}: CookieConsentBannerProps) {
  const [visible, setVisible] = useState(false)

  const notifyAnalyticsConsent = useCallback(() => {
    const recordedKey = `${SCAN_RECORDED_KEY_PREFIX}${scopeKey}`
    if (sessionStorage.getItem(recordedKey)) return
    // Marked before notifying so the guard still holds if the caller re-renders,
    // React re-runs the mount effect, or the record request fails — a scan is a
    // visit, and a refresh must not count as a second one.
    sessionStorage.setItem(recordedKey, 'true')
    onAnalyticsConsent()
  }, [scopeKey, onAnalyticsConsent])

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY)
    // Anything other than a recognised decision (including the pre-beta `'true'`
    // dismissal flag) counts as undecided — re-asking is the conservative posture.
    if (stored === 'granted') {
      notifyAnalyticsConsent()
      return
    }
    if (stored !== 'denied') setVisible(true)
  }, [notifyAnalyticsConsent])

  const decide = (decision: ConsentDecision) => {
    localStorage.setItem(CONSENT_KEY, decision)
    setVisible(false)
    if (decision === 'granted') notifyAnalyticsConsent()
  }

  if (!visible) return null

  return (
    <div
      role="region"
      aria-label="Analytics consent"
      className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white border-t border-gray-200 shadow-lg"
    >
      {/* One row from sm up so the bar stays as short as the dismiss-only version it
          replaces — it is fixed over the bottom of the portal's own content. */}
      <div className="max-w-lg mx-auto flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-gray-600">
          If you accept, we count this visit and store a hashed version of your IP address
          alongside a session cookie, so the property can see how often its code is
          scanned and so the same rating is not counted twice. A hashed IP address is
          pseudonymised personal data, not anonymous. The destinations on this page work
          either way.
        </p>
        <div className="flex shrink-0 justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => decide('denied')}>
            Reject
          </Button>
          <Button size="sm" onClick={() => decide('granted')}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  )
}
