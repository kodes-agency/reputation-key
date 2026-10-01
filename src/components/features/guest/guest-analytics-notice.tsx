import { Button } from '#/components/ui/button'
import {
  getGuestPortalCopy,
  type GuestPortalLanguagePackVersion,
  type GuestPortalLocale,
} from './public-portal/guest-language-pack'
import {
  usePortalVisitRecording,
  type PortalVisitRecorder,
} from './portal-visit-recording'
import { useVisitNoticeAcknowledgement } from './visit-notice-acknowledgement'

export type GuestAnalyticsNoticeProps = Readonly<{
  /** Stable Portal identity used to separate visits to different Portals. */
  scopeKey: string
  /** Signed-session identity used to separate successive guests in one browser tab. */
  sessionKey: string
  locale?: GuestPortalLocale
  languagePackVersion?: GuestPortalLanguagePackVersion
  /** Invoked once per browser session to record the portal visit. */
  onPortalVisit: PortalVisitRecorder
}>

/**
 * Disclosure for the portal's core visit analytics on the legacy guest page
 * (schema versions 1 and 2): a bar fixed to the bottom of the screen. The
 * Immersive Hub shows the same disclosure inline in its footer.
 */
export function GuestAnalyticsNotice({
  scopeKey,
  sessionKey,
  onPortalVisit,
  locale = 'en',
  languagePackVersion,
}: GuestAnalyticsNoticeProps) {
  const copy = getGuestPortalCopy(locale, languagePackVersion)
  const { isNoticeVisible, acknowledge } = useVisitNoticeAcknowledgement()
  usePortalVisitRecording({ scopeKey, sessionKey, onPortalVisit })

  if (!isNoticeVisible) return null

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
