import {
  usePortalVisitRecording,
  type PortalVisitRecorder,
} from '../../portal-visit-recording'
import { useVisitNoticeAcknowledgement } from '../../visit-notice-acknowledgement'
import type { ImmersiveFooterCopy } from './immersive-footer-copy'
import {
  IMMERSIVE_FOOTER_CSS,
  IMMERSIVE_FOOTER_STYLE_HREF,
} from './immersive-footer-styles'

const PRIVACY_HREF = '/privacy'

export type ImmersiveFooterViewProps = Readonly<{
  copy: ImmersiveFooterCopy
  /** Whether the visit notice is showing. It is inline in the footer, never an overlay. */
  isNoticeVisible: boolean
  onAcknowledge: () => void
}>

/**
 * The page footer as a pure view (boards G01 and G04). While the guest has not
 * acknowledged the notice, it holds the disclosure, the privacy link and "Got
 * it". Afterwards it is one row: the privacy link and the attribution.
 */
export function ImmersiveFooterView({
  copy,
  isNoticeVisible,
  onAcknowledge,
}: ImmersiveFooterViewProps) {
  return (
    <footer className="ih-footer">
      <style href={IMMERSIVE_FOOTER_STYLE_HREF} precedence="default">
        {IMMERSIVE_FOOTER_CSS}
      </style>
      {isNoticeVisible ? (
        <section aria-label={copy.noticeLabel} className="ih-footer__notice">
          <p className="ih-footer__text">{copy.visitNotice}</p>
          <div className="ih-footer__actions">
            <a href={PRIVACY_HREF} className="ih-link-accent ih-footer__link">
              {copy.privacyLink}
            </a>
            <button type="button" className="ih-footer__ack" onClick={onAcknowledge}>
              <span className="ih-footer__ack-pill">{copy.acknowledge}</span>
            </button>
          </div>
        </section>
      ) : (
        <div className="ih-footer__row">
          <a href={PRIVACY_HREF} className="ih-link-accent ih-footer__link">
            {copy.privacyLink}
          </a>
          <p className="ih-footer__made">{copy.madeWith}</p>
        </div>
      )}
    </footer>
  )
}

export type ImmersiveFooterProps = Readonly<{
  copy: ImmersiveFooterCopy
  /** Stable Portal identity used to separate visits to different Portals. */
  scopeKey: string
  /** Signed-session identity used to separate successive guests in one browser tab. */
  sessionKey: string
  /** Invoked once per browser session to record the portal visit. */
  onPortalVisit: PortalVisitRecorder
}>

/**
 * The footer of a live Immersive Hub page: the view, bound to the guest's
 * acknowledgement and to visit recording. Recording does not depend on the
 * notice: the visit is counted on mount, whether the guest acknowledges the
 * notice, has already done so, or never sees it (ADR 0044).
 */
export function ImmersiveFooter({
  copy,
  scopeKey,
  sessionKey,
  onPortalVisit,
}: ImmersiveFooterProps) {
  const { isNoticeVisible, acknowledge } = useVisitNoticeAcknowledgement()
  usePortalVisitRecording({ scopeKey, sessionKey, onPortalVisit })
  return (
    <ImmersiveFooterView
      copy={copy}
      isNoticeVisible={isNoticeVisible}
      onAcknowledge={acknowledge}
    />
  )
}
