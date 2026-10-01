import { useCallback, useState, useSyncExternalStore } from 'react'

/**
 * Where a guest's "Got it" is remembered. Both guest renderers share the key, so
 * a guest who has acknowledged the notice on one page does not see it on another.
 */
export const VISIT_NOTICE_ACKNOWLEDGED_KEY = 'guest-analytics-notice-acknowledged'

const subscribeToAcknowledgement = () => () => undefined

function acknowledgementSnapshot(): boolean {
  try {
    return localStorage.getItem(VISIT_NOTICE_ACKNOWLEDGED_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Whether the visit notice is shown, and how to dismiss it. Acknowledgement
 * controls only whether the notice is shown again; it never enables or disables
 * measurement (`usePortalVisitRecording` does not read it).
 *
 * The notice is client-only on purpose: the server cannot see `localStorage`,
 * so the server snapshot reads "acknowledged" and the notice appears after
 * hydration for a guest who has not acknowledged it.
 */
export function useVisitNoticeAcknowledgement(): Readonly<{
  isNoticeVisible: boolean
  acknowledge: () => void
}> {
  const acknowledged = useSyncExternalStore(
    subscribeToAcknowledgement,
    acknowledgementSnapshot,
    () => true,
  )
  const [dismissed, setDismissed] = useState(false)

  const acknowledge = useCallback(() => {
    try {
      localStorage.setItem(VISIT_NOTICE_ACKNOWLEDGED_KEY, 'true')
    } catch {
      // The notice can still be dismissed for this page if storage is unavailable.
    }
    setDismissed(true)
  }, [])

  return { isNoticeVisible: !(acknowledged || dismissed), acknowledge }
}
